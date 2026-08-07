import { useEffect, useMemo, useRef, useState } from 'react';
import { Asset } from 'expo-asset';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Card,
  GhostButton,
  PrimaryButton,
  SecondaryButton,
} from './src/components/Ui';
import { analyzeReceipt } from './src/services/api';
import {
  deleteTransferAccount,
  loadTransferAccounts,
  saveTransferAccount,
  type SavedTransferAccount,
} from './src/services/transferAccounts';
import type { ReceiptItem, TransferData } from './src/types';
import { formatClp } from './src/utils/money';
import { shareOnWhatsApp } from './src/utils/share';
import { parseTransferText } from './src/utils/transferParser';

const STEPS = ['Boleta', 'Productos', 'Personas', 'Reparto', 'Cobro'];
const STEP_ICONS = ['🧾', '✓', '👥', '↗', '$'];
const TEST_RECEIPT_MODULE = require('./assets/test/boleta-irish-geopub.jpg');
const TEST_RECEIPT_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_TEST_RECEIPT === 'true';

const EMPTY_TRANSFER: TransferData = {
  bank: '',
  accountType: '',
  accountNumber: '',
  rut: '',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe}>
        <Main />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Main() {
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState(0);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [loadingTestReceipt, setLoadingTestReceipt] = useState(false);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [invitedPeople, setInvitedPeople] = useState<string[]>([]);
  const [newPerson, setNewPerson] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [payer, setPayer] = useState('');
  const [tipPercent, setTipPercent] = useState('10');
  const [includeTransfer, setIncludeTransfer] = useState(true);
  const [transfer, setTransfer] = useState<TransferData>(EMPTY_TRANSFER);

  const [savedAccounts, setSavedAccounts] = useState<SavedTransferAccount[]>([]);
  const [accountsModalVisible, setAccountsModalVisible] = useState(false);
  const [saveAccountModalVisible, setSaveAccountModalVisible] = useState(false);
  const [accountLabel, setAccountLabel] = useState('');

  useEffect(() => {
    loadTransferAccounts()
      .then((accounts) => {
        setSavedAccounts(accounts);
        const preferred =
          accounts.find((account) => account.isDefault) ?? accounts[0];
        if (preferred) setTransfer(preferred.transfer);
      })
      .catch((error) =>
        console.error('[Cuánto Pago] Error cargando cuentas:', error),
      );
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [step]);

  const selectImage = (uri: string, mimeType = 'image/jpeg') => {
    setImageUri(uri);
    setImageMime(mimeType);
  };

  const pickImage = async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permiso necesario',
        'Debes autorizar el acceso para seleccionar la boleta.',
      );
      return;
    }

    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.82,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.82,
        });

    if (!result.canceled) {
      const selected = result.assets[0];
      selectImage(selected.uri, selected.mimeType || 'image/jpeg');
    }
  };

  const loadTestReceipt = async () => {
    setLoadingTestReceipt(true);
    try {
      const [asset] = await Asset.loadAsync(TEST_RECEIPT_MODULE);
      if (!asset.localUri) {
        throw new Error(
          'La imagen de prueba no pudo copiarse al almacenamiento temporal.',
        );
      }
      selectImage(asset.localUri, 'image/jpeg');
    } catch (error) {
      Alert.alert(
        'No se pudo cargar la boleta de prueba',
        error instanceof Error ? error.message : 'Error desconocido',
      );
    } finally {
      setLoadingTestReceipt(false);
    }
  };

  const scan = async () => {
    if (!imageUri) {
      Alert.alert(
        'Falta la boleta',
        'Primero selecciona una imagen o carga la boleta de ejemplo.',
      );
      return;
    }

    setLoading(true);
    try {
      const result = await analyzeReceipt(imageUri, imageMime);
      setItems(result.items || []);
      setAssignments({});
      setStep(1);
    } catch (error) {
      Alert.alert(
        'No se pudo leer la boleta',
        error instanceof Error ? error.message : 'Error desconocido',
      );
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      { id: `manual-${Date.now()}`, name: '', price: 0, quantity: 1 },
    ]);
  };

  const splitItemUnits = (item: ReceiptItem) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    if (quantity <= 1) return;

    const total = Math.max(0, Math.round(Number(item.price) || 0));
    const basePrice = Math.floor(total / quantity);
    const remainder = total - basePrice * quantity;

    const units: ReceiptItem[] = Array.from({ length: quantity }, (_, index) => ({
      ...item,
      id: `${item.id}-unit-${index + 1}-${Date.now()}`,
      name: `${item.name} ${index + 1}`,
      quantity: 1,
      price: basePrice + (index < remainder ? 1 : 0),
    }));

    setItems((current) =>
      current.flatMap((currentItem) =>
        currentItem.id === item.id ? units : [currentItem],
      ),
    );

    setAssignments((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  };

  const addPerson = () => {
    const clean = newPerson.trim();
    if (!clean || people.includes(clean)) return;
    setPeople((current) => [...current, clean]);
    setNewPerson('');
    if (!payer) setPayer(clean);
  };

  const removePerson = (person: string) => {
    setPeople((current) => current.filter((name) => name !== person));
    setAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([itemId, names]) => [
          itemId,
          names.filter((name) => name !== person),
        ]),
      ),
    );
    setInvitedPeople((current) =>
      current.filter((name) => name !== person),
    );
    if (payer === person) setPayer('');
  };

  const toggleInvitedPerson = (person: string) => {
    setInvitedPeople((current) =>
      current.includes(person)
        ? current.filter((name) => name !== person)
        : [...current, person],
    );
  };

  const toggleAssignment = (itemId: string, person: string) => {
    setAssignments((current) => {
      const selected = current[itemId] || [];
      const next = selected.includes(person)
        ? selected.filter((name) => name !== person)
        : [...selected, person];
      return { ...current, [itemId]: next };
    });
  };

  const billBreakdown = useMemo(() => {
    const ownConsumption = Object.fromEntries(
      people.map((person) => [person, 0]),
    ) as Record<string, number>;

    for (const item of items) {
      const consumers = assignments[item.id] || [];
      if (!consumers.length) continue;
      for (const person of consumers) {
        ownConsumption[person] += item.price / consumers.length;
      }
    }

    const invitedSet = new Set(invitedPeople);
    const hosts = people.filter((person) => !invitedSet.has(person));
    const invitationShare = Object.fromEntries(
      people.map((person) => [person, 0]),
    ) as Record<string, number>;
    const adjusted = { ...ownConsumption };

    if (hosts.length) {
      for (const invited of invitedPeople) {
        const invitedConsumption = ownConsumption[invited] || 0;
        adjusted[invited] = 0;
        const share = invitedConsumption / hosts.length;
        for (const host of hosts) {
          adjusted[host] += share;
          invitationShare[host] += share;
        }
      }
    }

    const tip = Math.max(0, Number(tipPercent) || 0);
    const multiplier = 1 + tip / 100;

    return {
      totals: Object.fromEntries(
        Object.entries(adjusted).map(([person, value]) => [
          person,
          value * multiplier,
        ]),
      ) as Record<string, number>,
      invitationShare: Object.fromEntries(
        Object.entries(invitationShare).map(([person, value]) => [
          person,
          value * multiplier,
        ]),
      ) as Record<string, number>,
      ownConsumption,
    };
  }, [assignments, invitedPeople, items, people, tipPercent]);

  const totals = billBreakdown.totals;

  const totalReceipt = items.reduce(
    (sum, item) => sum + Number(item.price || 0),
    0,
  );

  const recoverAmount = people
    .filter((person) => person !== payer)
    .reduce((sum, person) => sum + (totals[person] || 0), 0);

  const transferMessage = `${payer}
RUT: ${transfer.rut}
Banco: ${transfer.bank}
Tipo de cuenta: ${transfer.accountType}
N° de cuenta: ${transfer.accountNumber}`;

  const groupMessage = `¡Hola! 🧾 Resumen de la cuenta (incluye ${
    Number(tipPercent) || 0
  }% de propina):

${people
  .map((person) =>
    person === payer
      ? `✅ ${person} (pagó) — Consumo: ${formatClp(totals[person] || 0)}`
      : invitedPeople.includes(person)
        ? `🎁 ${person}: Invitado por el grupo — ${formatClp(totals[person] || 0)}`
        : `🔹 ${person}: ${formatClp(totals[person] || 0)}`,
  )
  .join('\n')}`;

  const pasteTransferData = async () => {
    const text = await Clipboard.getStringAsync();

    if (!text.trim()) {
      Alert.alert(
        'Portapapeles vacío',
        'Copia primero los datos desde la aplicación de tu banco.',
      );
      return;
    }

    const parsed = parseTransferText(text);
    const detectedCount = Object.values(parsed).filter(Boolean).length;

    if (!detectedCount) {
      Alert.alert(
        'No pudimos reconocer los datos',
        'Completa manualmente lo que falte.',
      );
      return;
    }

    setTransfer((current) => ({
      bank: parsed.bank || current.bank,
      accountType: parsed.accountType || current.accountType,
      accountNumber: parsed.accountNumber || current.accountNumber,
      rut: parsed.rut || current.rut,
    }));

    Alert.alert('Datos detectados', 'Revísalos antes de compartir.');
  };

  const openSaveAccount = () => {
    if (
      !transfer.bank.trim() ||
      !transfer.accountType.trim() ||
      !transfer.accountNumber.trim() ||
      !transfer.rut.trim()
    ) {
      Alert.alert(
        'Faltan datos',
        'Completa banco, tipo de cuenta, número y RUT antes de guardar.',
      );
      return;
    }

    setAccountLabel(
      savedAccounts.length
        ? `Cuenta ${savedAccounts.length + 1}`
        : 'Cuenta principal',
    );
    setSaveAccountModalVisible(true);
  };

  const confirmSaveAccount = async () => {
    const label = accountLabel.trim();
    if (!label) return;

    const updated = await saveTransferAccount({
      label,
      transfer,
      isDefault: savedAccounts.length === 0,
    });

    setSavedAccounts(updated);
    setSaveAccountModalVisible(false);
    setAccountLabel('');
    Alert.alert('Cuenta guardada', 'Podrás reutilizarla en futuras cuentas.');
  };

  const selectSavedAccount = (account: SavedTransferAccount) => {
    setTransfer(account.transfer);
    setAccountsModalVisible(false);
  };

  const removeSavedAccount = async (id: string) => {
    const updated = await deleteTransferAccount(id);
    setSavedAccounts(updated);
  };

  const reset = () => {
    setStep(0);
    setImageUri(null);
    setItems([]);
    setPeople([]);
    setInvitedPeople([]);
    setAssignments({});
    setPayer('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandWrap}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>⌣</Text>
            </View>
            <View>
              <Text style={styles.brand}>Cuánto Pago</Text>
              <Text style={styles.subtitle}>Divide sin complicaciones</Text>
            </View>
          </View>
          <View style={styles.stepPill}>
            <Text style={styles.stepPillText}>{step + 1}/5</Text>
          </View>
        </View>

        <View style={styles.stepper}>
          {STEPS.map((label, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <Pressable
                key={label}
                style={styles.stepItem}
                onPress={() => index < step && setStep(index)}
              >
                <View
                  style={[
                    styles.stepCircle,
                    active && styles.stepCircleActive,
                    done && styles.stepCircleDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepCircleText,
                      (active || done) && styles.stepCircleTextActive,
                    ]}
                  >
                    {done ? '✓' : STEP_ICONS[index]}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.stepName,
                    active && styles.stepNameActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {step === 0 && (
          <>
            <View style={styles.hero}>
              <View style={styles.heroBadge}><Text style={styles.heroEyebrow}>LA FORMA MÁS FÁCIL DE DIVIDIR CUENTAS</Text></View>
              <Text style={styles.heroTitle}>Divide la cuenta</Text>
              <Text style={styles.heroTitleAccent}>sin complicaciones</Text>
              <Text style={styles.heroText}>
                Escanea la boleta, asigna lo que consumió cada persona y descubre cuánto debe pagar cada uno en segundos.
              </Text>
            </View>

            <Card>
              <View style={styles.receiptFrame}>
                {imageUri ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.receiptImage}
                  />
                ) : (
                  <View style={styles.placeholder}>
                    <View style={styles.receiptIllustration}>
                      <Text style={styles.receiptIllustrationIcon}>🧾</Text>
                    </View>
                    <Text style={styles.placeholderTitle}>
                      Tu boleta aparecerá aquí
                    </Text>
                    <Text style={styles.placeholderText}>
                      Asegúrate de que se vea completa y sin reflejos.
                    </Text>
                  </View>
                )}
              </View>

              <PrimaryButton
                label="Tomar foto"
                icon="📷"
                onPress={() => pickImage(true)}
              />
              <SecondaryButton
                label="Elegir de galería"
                icon="🖼️"
                onPress={() => pickImage(false)}
              />

              {TEST_RECEIPT_ENABLED && (
                <GhostButton
                  label={
                    loadingTestReceipt
                      ? 'Cargando boleta de ejemplo…'
                      : 'Probar con boleta de ejemplo'
                  }
                  icon="🧪"
                  onPress={loadTestReceipt}
                  disabled={loadingTestReceipt || loading}
                />
              )}

              {loading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color="#6C45E8" />
                  <Text style={styles.loadingTitle}>
                    Gemini está leyendo la boleta
                  </Text>
                  <Text style={styles.loadingText}>
                    Esto puede tardar unos segundos.
                  </Text>
                </View>
              ) : (
                <PrimaryButton
                  label="Leer boleta con Gemini"
                  icon="✨"
                  onPress={scan}
                  disabled={!imageUri}
                />
              )}
            </Card>
          </>
        )}

        {step === 1 && (
          <Card>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.cardTitle}>Productos detectados</Text>
                <Text style={styles.muted}>
                  Revisa nombres y precios antes de continuar.
                </Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{items.length}</Text>
              </View>
            </View>

            {items.map((item) => (
              <View key={item.id} style={styles.productBlock}>
                <View style={styles.productRow}>
                  <View style={styles.quantityCircle}>
                    <Text style={styles.quantityText}>
                      {item.quantity || 1}
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    placeholder="Producto"
                    value={item.name}
                    onChangeText={(name) =>
                      setItems((current) =>
                        current.map((value) =>
                          value.id === item.id ? { ...value, name } : value,
                        ),
                      )
                    }
                  />
                  <TextInput
                    style={[styles.input, styles.priceInput]}
                    placeholder="$0"
                    keyboardType="number-pad"
                    value={item.price ? String(item.price) : ''}
                    onChangeText={(value) =>
                      setItems((current) =>
                        current.map((currentItem) =>
                          currentItem.id === item.id
                            ? {
                                ...currentItem,
                                price:
                                  Number(value.replace(/\D/g, '')) || 0,
                              }
                            : currentItem,
                        ),
                      )
                    }
                  />
                  <Pressable
                    onPress={() =>
                      setItems((current) =>
                        current.filter((value) => value.id !== item.id),
                      )
                    }
                  >
                    <Text style={styles.delete}>×</Text>
                  </Pressable>
                </View>

                {(Number(item.quantity) || 1) > 1 && (
                  <View style={styles.splitBox}>
                    <View style={styles.flex}>
                      <Text style={styles.splitTitle}>
                        {item.quantity} unidades por {formatClp(
                          Math.round(item.price / (item.quantity || 1)),
                        )} aprox. cada una
                      </Text>
                      <Text style={styles.splitText}>
                        Desglósalas para asignarlas a personas distintas.
                      </Text>
                    </View>
                    <Pressable
                      style={styles.splitButton}
                      onPress={() => splitItemUnits(item)}
                    >
                      <Text style={styles.splitButtonText}>Desglosar</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}

            <SecondaryButton
              label="Agregar producto"
              icon="＋"
              onPress={addItem}
            />

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total leído</Text>
              <Text style={styles.totalAmount}>
                {formatClp(totalReceipt)}
              </Text>
            </View>

            <NavButtons
              back={() => setStep(0)}
              next={() => setStep(2)}
              nextDisabled={
                !items.length ||
                items.some((item) => !item.name || item.price <= 0)
              }
            />
          </Card>
        )}

        {step === 2 && (
          <Card>
            <Text style={styles.cardTitle}>¿Quiénes participaron?</Text>
            <Text style={styles.muted}>
              Agrega a todas las personas que participaron de la cuenta.
            </Text>

            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex]}
                placeholder="Nombre"
                value={newPerson}
                onChangeText={setNewPerson}
                onSubmitEditing={addPerson}
              />
              <Pressable style={styles.addButton} onPress={addPerson}>
                <Text style={styles.addButtonText}>Agregar</Text>
              </Pressable>
            </View>

            <View style={styles.peopleList}>
              {people.map((person, index) => (
                <View key={`${person}-${index}`} style={styles.personRow}>
                  <PersonAvatar name={person} index={index} />
                  <View style={styles.flex}>
                    <Text style={styles.personName}>{person}</Text>
                    {invitedPeople.includes(person) && (
                      <Text style={styles.invitedCaption}>
                        🎁 Invitado por el grupo
                      </Text>
                    )}
                  </View>
                  <Pressable
                    style={[
                      styles.inviteButton,
                      invitedPeople.includes(person) &&
                        styles.inviteButtonSelected,
                    ]}
                    onPress={() => toggleInvitedPerson(person)}
                  >
                    <Text
                      style={[
                        styles.inviteButtonText,
                        invitedPeople.includes(person) &&
                          styles.inviteButtonTextSelected,
                      ]}
                    >
                      {invitedPeople.includes(person) ? 'Invitado ✓' : '🎁 Invitar'}
                    </Text>
                  </Pressable>
                  {payer === person && (
                    <Text style={styles.payerBadge}>Pagó</Text>
                  )}
                  <Pressable
                    onPress={() => removePerson(person)}
                    hitSlop={10}
                  >
                    <Text style={styles.removePerson}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <NavButtons
              back={() => setStep(1)}
              next={() => setStep(3)}
              nextDisabled={people.length < 2}
            />
          </Card>
        )}

        {step === 3 && (
          <Card>
            <Text style={styles.cardTitle}>Asigna los productos</Text>
            <Text style={styles.muted}>
              Toca una o varias personas para indicar quién consumió cada
              producto.
            </Text>

            {items.map((item) => (
              <View key={item.id} style={styles.assignmentCard}>
                <View style={styles.spaceBetween}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemPrice}>
                    {formatClp(item.price)}
                  </Text>
                </View>

                <View style={styles.chips}>
                  {people.map((person, index) => {
                    const selected = (
                      assignments[item.id] || []
                    ).includes(person);

                    return (
                      <Pressable
                        key={`${person}-${index}`}
                        style={[
                          styles.personChip,
                          selected && styles.personChipSelected,
                        ]}
                        onPress={() =>
                          toggleAssignment(item.id, person)
                        }
                      >
                        <PersonAvatar
                          name={person}
                          index={index}
                          size={28}
                          selected={selected}
                        />
                        <Text
                          style={[
                            styles.personChipText,
                            selected && styles.personChipTextSelected,
                          ]}
                        >
                          {person}{invitedPeople.includes(person) ? ' 🎁' : ''}
                        </Text>
                        {selected && (
                          <Text style={styles.personChipCheck}>✓</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>

                {!!(assignments[item.id] || []).length && (
                  <Text style={styles.assignmentHint}>
                    Se divide entre {(assignments[item.id] || []).length}{' '}
                    {(assignments[item.id] || []).length === 1
                      ? 'persona'
                      : 'personas'}
                  </Text>
                )}
              </View>
            ))}

            <NavButtons
              back={() => setStep(2)}
              next={() => setStep(4)}
              nextDisabled={items.some(
                (item) => !(assignments[item.id] || []).length,
              )}
            />
          </Card>
        )}

        {step === 4 && (
          <>
            <Card>
              <Text style={styles.cardTitle}>Datos para cobrar</Text>
              <Text style={styles.muted}>
                Elige quién pagó y agrega los datos donde quieres recibir el
                dinero.
              </Text>

              <Text style={styles.label}>¿Quién pagó?</Text>
              <View style={styles.chips}>
                {people.map((person, index) => (
                  <Pressable
                    key={`${person}-${index}`}
                    style={[
                      styles.personChip,
                      payer === person && styles.personChipSelected,
                    ]}
                    onPress={() => setPayer(person)}
                  >
                    <PersonAvatar
                      name={person}
                      index={index}
                      size={28}
                      selected={payer === person}
                    />
                    <Text
                      style={[
                        styles.personChipText,
                        payer === person &&
                          styles.personChipTextSelected,
                      ]}
                    >
                      {person}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Propina (%)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={tipPercent}
                onChangeText={setTipPercent}
              />

              <View style={styles.spaceBetween}>
                <Text style={styles.label}>
                  Incluir datos de transferencia
                </Text>
                <Switch
                  value={includeTransfer}
                  onValueChange={setIncludeTransfer}
                  trackColor={{ true: '#CFC0FF', false: '#DDD8E8' }}
                  thumbColor={includeTransfer ? '#6C45E8' : '#FFFFFF'}
                />
              </View>

              {includeTransfer && (
                <>
                  <View style={styles.transferActions}>
                    <View style={styles.flex}>
                      <SecondaryButton
                        label="Pegar desde banco"
                        icon="📋"
                        onPress={pasteTransferData}
                      />
                    </View>
                    <View style={styles.flex}>
                      <SecondaryButton
                        label="Mis cuentas"
                        icon="🏦"
                        onPress={() =>
                          setAccountsModalVisible(true)
                        }
                      />
                    </View>
                  </View>

                  <View style={styles.transferBox}>
                    <TextInput
                      style={styles.input}
                      placeholder="Banco — Ej: BancoEstado"
                      placeholderTextColor="#92929A"
                      value={transfer.bank}
                      onChangeText={(bank) =>
                        setTransfer((current) => ({
                          ...current,
                          bank,
                        }))
                      }
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Tipo de cuenta — Ej: Cuenta RUT"
                      placeholderTextColor="#92929A"
                      value={transfer.accountType}
                      onChangeText={(accountType) =>
                        setTransfer((current) => ({
                          ...current,
                          accountType,
                        }))
                      }
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Número de cuenta — Ej: 12345678"
                      placeholderTextColor="#92929A"
                      keyboardType="number-pad"
                      value={transfer.accountNumber}
                      onChangeText={(accountNumber) =>
                        setTransfer((current) => ({
                          ...current,
                          accountNumber,
                        }))
                      }
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="RUT — Ej: 12.345.678-9"
                      placeholderTextColor="#92929A"
                      autoCapitalize="characters"
                      value={transfer.rut}
                      onChangeText={(rut) =>
                        setTransfer((current) => ({
                          ...current,
                          rut,
                        }))
                      }
                    />

                    <GhostButton
                      label="Guardar en Mis cuentas"
                      icon="＋"
                      onPress={openSaveAccount}
                    />
                    <Text style={styles.localDataHint}>
                      🔒 Tus datos se guardan solo en este dispositivo.
                    </Text>
                  </View>
                </>
              )}
            </Card>

            <Card tone="dark">
              <Text style={styles.darkEyebrow}>RESUMEN FINAL</Text>
              <Text style={styles.darkTitle}>
                ¡Listo! Así queda la cuenta
              </Text>

              <View style={styles.summaryTotalCard}>
                <Text style={styles.summaryTotalLabel}>
                  Total de la cuenta
                </Text>
                <Text style={styles.summaryTotalAmount}>
                  {formatClp(
                    Object.values(totals).reduce(
                      (sum, value) => sum + value,
                      0,
                    ),
                  )}
                </Text>
                <Text style={styles.summaryPayer}>
                  Pagó: {payer || 'Selecciona una persona'}
                </Text>
              </View>

              <View style={styles.summaryList}>
                {people.map((person, index) => (
                  <View
                    key={`${person}-${index}`}
                    style={styles.summaryRow}
                  >
                    <PersonAvatar
                      name={person}
                      index={index}
                      size={36}
                    />
                    <View style={styles.flex}>
                      <Text style={styles.summaryPerson}>
                        {person}
                        {person === payer ? ' (pagó)' : ''}
                      </Text>
                      <Text style={styles.summaryDetail}>
                        {invitedPeople.includes(person)
                          ? '🎁 Invitado por el grupo'
                          : person === payer
                            ? billBreakdown.invitationShare[person]
                              ? `Consumo + ${formatClp(
                                  billBreakdown.invitationShare[person],
                                )} de invitación`
                              : 'Consumo personal'
                            : billBreakdown.invitationShare[person]
                              ? `Incluye ${formatClp(
                                  billBreakdown.invitationShare[person],
                                )} de invitación`
                              : totals[person]
                                ? 'Debe transferir'
                                : 'Sin deuda'}
                      </Text>
                    </View>
                    <Text style={styles.summaryAmount}>
                      {formatClp(totals[person] || 0)}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.recoverCard}>
                <Text style={styles.recoverLabel}>
                  {payer || 'Quien pagó'} debe recuperar
                </Text>
                <Text style={styles.recoverAmount}>
                  {formatClp(recoverAmount)}
                </Text>
              </View>

              <PrimaryButton
                label="Compartir por WhatsApp"
                icon="💬"
                onPress={() =>
                  shareOnWhatsApp(groupMessage).catch((error) =>
                    Alert.alert('Error', error.message),
                  )
                }
              />

              {includeTransfer && (
                <SecondaryButton
                  label="Compartir datos de transferencia"
                  icon="🏦"
                  onPress={() =>
                    shareOnWhatsApp(transferMessage).catch(
                      (error) =>
                        Alert.alert('Error', error.message),
                    )
                  }
                />
              )}

              {people
                .filter(
                  (person) =>
                    person !== payer && !invitedPeople.includes(person),
                )
                .map((person) => (
                  <SecondaryButton
                    key={person}
                    label={`Cobrar a ${person}: ${formatClp(
                      totals[person] || 0,
                    )}`}
                    onPress={() => {
                      const message = `¡Hola ${person}! 👋 Tu parte de la cuenta es ${formatClp(
                        totals[person] || 0,
                      )} (incluye ${
                        Number(tipPercent) || 0
                      }% de propina).${
                        includeTransfer
                          ? `\n\n${transferMessage}`
                          : ''
                      }`;

                      shareOnWhatsApp(message).catch((error) =>
                        Alert.alert('Error', error.message),
                      );
                    }}
                  />
                ))}

              <View style={styles.row}>
                <View style={styles.flex}>
                  <SecondaryButton
                    label="Atrás"
                    onPress={() => setStep(3)}
                  />
                </View>
                <View style={styles.flex}>
                  <PrimaryButton
                    label="Nueva cuenta"
                    onPress={reset}
                  />
                </View>
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <AccountsModal
        visible={accountsModalVisible}
        accounts={savedAccounts}
        onClose={() => setAccountsModalVisible(false)}
        onSelect={selectSavedAccount}
        onDelete={removeSavedAccount}
      />

      <Modal
        visible={saveAccountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveAccountModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Guardar cuenta</Text>
            <Text style={styles.muted}>
              Ponle un nombre fácil de reconocer.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Cuenta personal"
              value={accountLabel}
              onChangeText={setAccountLabel}
              autoFocus
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <SecondaryButton
                  label="Cancelar"
                  onPress={() =>
                    setSaveAccountModalVisible(false)
                  }
                />
              </View>
              <View style={styles.flex}>
                <PrimaryButton
                  label="Guardar"
                  onPress={confirmSaveAccount}
                  disabled={!accountLabel.trim()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function AccountsModal({
  visible,
  accounts,
  onClose,
  onSelect,
  onDelete,
}: {
  visible: boolean;
  accounts: SavedTransferAccount[];
  onClose: () => void;
  onSelect: (account: SavedTransferAccount) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.spaceBetween}>
            <Text style={styles.modalTitle}>Mis cuentas</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.modalClose}>×</Text>
            </Pressable>
          </View>

          {!accounts.length ? (
            <Text style={styles.muted}>
              Aún no tienes cuentas guardadas.
            </Text>
          ) : (
            accounts.map((account) => (
              <View key={account.id} style={styles.savedAccount}>
                <Pressable
                  style={styles.savedAccountMain}
                  onPress={() => onSelect(account)}
                >
                  <View style={styles.bankAvatar}>
                    <Text style={styles.bankAvatarText}>
                      {account.label.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.savedAccountLabel}>
                      {account.label}
                    </Text>
                    <Text style={styles.savedAccountDetail}>
                      {account.transfer.bank} ·{' '}
                      {account.transfer.accountType}
                    </Text>
                    <Text style={styles.savedAccountDetail}>
                      ••••{account.transfer.accountNumber.slice(-4)}
                    </Text>
                  </View>
                  {account.isDefault && (
                    <Text style={styles.defaultBadge}>Principal</Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Eliminar cuenta',
                      `¿Eliminar “${account.label}”?`,
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Eliminar',
                          style: 'destructive',
                          onPress: () => onDelete(account.id),
                        },
                      ],
                    )
                  }
                >
                  <Text style={styles.deleteAccount}>Eliminar</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      </View>
    </Modal>
  );
}

function PersonAvatar({
  name,
  index,
  size = 38,
  selected = false,
}: {
  name: string;
  index: number;
  size?: number;
  selected?: boolean;
}) {
  const colors = [
    '#6C45E8',
    '#4F6DE8',
    '#8B5CF6',
    '#C05BE0',
    '#E29B45',
    '#4FA6D8',
    '#7457D9',
    '#8E70E8',
  ];
  const color = colors[index % colors.length];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: selected ? '#FFFFFF' : color,
        },
      ]}
    >
      <Text
        style={[
          styles.avatarText,
          {
            fontSize: Math.max(12, size * 0.42),
            color: selected ? '#12183F' : '#FFFFFF',
          },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

function NavButtons({
  back,
  next,
  nextDisabled = false,
}: {
  back: () => void;
  next: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <SecondaryButton label="Atrás" onPress={back} />
      </View>
      <View style={styles.flex}>
        <PrimaryButton
          label="Continuar"
          onPress={next}
          disabled={nextDisabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBFAFF' },
  flex: { flex: 1 },
  container: {
    padding: 18,
    paddingBottom: 48,
    gap: 16,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#6C45E8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C45E8',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  logoMarkText: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 29,
    fontWeight: '900',
    transform: [{ rotate: '180deg' }],
  },
  brand: {
    fontSize: 28,
    fontWeight: '900',
    color: '#12183F',
  },
  subtitle: {
    color: '#73778B',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  stepPill: {
    backgroundColor: '#F0EAFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  stepPillText: {
    color: '#6C45E8',
    fontWeight: '900',
  },
  stepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ECE7F7',
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  stepCircle: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F1FA',
  },
  stepCircleActive: {
    backgroundColor: '#6C45E8',
  },
  stepCircleDone: {
    backgroundColor: '#DCD1FF',
  },
  stepCircleText: {
    fontSize: 13,
    color: '#8A8DA1',
    fontWeight: '900',
  },
  stepCircleTextActive: {
    color: '#FFFFFF',
  },
  stepName: {
    fontSize: 10,
    color: '#8A8DA1',
    fontWeight: '700',
  },
  stepNameActive: {
    color: '#6C45E8',
    fontWeight: '900',
  },
  hero: {
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 2,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0EAFF',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginBottom: 8,
  },
  heroEyebrow: {
    color: '#6C45E8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '900',
    color: '#12183F',
  },
  heroTitleAccent: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '900',
    color: '#6C45E8',
    marginTop: -1,
  },
  heroText: {
    color: '#73778B',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 5,
  },
  receiptFrame: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#FCFBFF',
    borderWidth: 1,
    borderColor: '#EAE4F5',
  },
  receiptImage: {
    width: '100%',
    height: 300,
    resizeMode: 'contain',
  },
  placeholder: {
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  receiptIllustration: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#EEE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  receiptIllustrationIcon: {
    fontSize: 48,
  },
  placeholderTitle: {
    color: '#161C44',
    fontSize: 17,
    fontWeight: '900',
  },
  placeholderText: {
    color: '#7B7F93',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  loadingTitle: {
    color: '#161C44',
    fontWeight: '900',
    fontSize: 16,
    marginTop: 10,
  },
  loadingText: {
    color: '#7B7F93',
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardTitle: {
    fontSize: 23,
    fontWeight: '900',
    color: '#161C44',
  },
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: '#777B8E',
    marginTop: 3,
  },
  countBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EEE8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#6C45E8',
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#DED8EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#1B214B',
  },
  productBlock: {
    gap: 8,
  },
  productRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  quantityCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1EEF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityText: {
    fontWeight: '900',
    color: '#676B80',
  },
  splitBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 38,
    backgroundColor: '#FFF8E9',
    borderRadius: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: '#F0D9A4',
  },
  splitTitle: {
    color: '#66511C',
    fontWeight: '900',
    fontSize: 13,
  },
  splitText: {
    color: '#876F3C',
    fontSize: 12,
    marginTop: 2,
  },
  splitButton: {
    backgroundColor: '#E0A126',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  splitButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
  },
  priceInput: {
    width: 108,
  },
  delete: {
    fontSize: 28,
    color: '#C25464',
    paddingHorizontal: 3,
  },
  totalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F1ECFF',
    borderRadius: 18,
    padding: 16,
  },
  totalLabel: {
    color: '#5E5775',
    fontWeight: '800',
  },
  totalAmount: {
    color: '#5E38D8',
    fontSize: 21,
    fontWeight: '900',
  },
  addButton: {
    height: 50,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#6C45E8',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  peopleList: {
    gap: 4,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECF7',
  },
  personName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#161C44',
  },
  invitedCaption: {
    color: '#976700',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  inviteButton: {
    borderWidth: 1,
    borderColor: '#E5C86B',
    backgroundColor: '#FFF9EA',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  inviteButtonSelected: {
    backgroundColor: '#E0A126',
    borderColor: '#E0A126',
  },
  inviteButtonText: {
    color: '#8A6100',
    fontSize: 11,
    fontWeight: '900',
  },
  inviteButtonTextSelected: {
    color: '#FFFFFF',
  },
  payerBadge: {
    color: '#5E38D8',
    backgroundColor: '#EEE8FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: '800',
    fontSize: 12,
  },
  removePerson: {
    fontSize: 26,
    color: '#B54C5A',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '900',
  },
  assignmentCard: {
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEAF6',
  },
  spaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  itemName: {
    fontSize: 17,
    fontWeight: '900',
    color: '#161C44',
    flex: 1,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '900',
    color: '#161C44',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  personChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DED7EB',
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  personChipSelected: {
    backgroundColor: '#12183F',
    borderColor: '#12183F',
  },
  personChipText: {
    color: '#5F6275',
    fontWeight: '800',
  },
  personChipTextSelected: {
    color: '#FFFFFF',
  },
  personChipCheck: {
    color: '#D9CBFF',
    fontWeight: '900',
  },
  assignmentHint: {
    color: '#777B8E',
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    fontSize: 14,
    color: '#565B72',
    fontWeight: '900',
  },
  transferActions: {
    flexDirection: 'row',
    gap: 10,
  },
  transferBox: {
    gap: 10,
    backgroundColor: '#FAF8FF',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EBE5F4',
  },
  localDataHint: {
    textAlign: 'center',
    color: '#777B8E',
    fontSize: 12,
    fontWeight: '700',
  },
  darkEyebrow: {
    color: '#D9CBFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  darkTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  summaryTotalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
  },
  summaryTotalLabel: {
    color: '#73778B',
    fontWeight: '800',
  },
  summaryTotalAmount: {
    color: '#12183F',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 5,
  },
  summaryPayer: {
    color: '#6C45E8',
    fontWeight: '900',
    marginTop: 8,
  },
  summaryList: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#1C2353',
    borderRadius: 16,
    padding: 12,
  },
  summaryPerson: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  summaryDetail: {
    color: '#C6C3D9',
    fontSize: 12,
    marginTop: 2,
  },
  summaryAmount: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  recoverCard: {
    backgroundColor: '#EEE8FF',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  recoverLabel: {
    color: '#5E5775',
    fontWeight: '800',
  },
  recoverAmount: {
    color: '#6C45E8',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(18,24,63,0.50)',
  },
  modalCard: {
    gap: 14,
    backgroundColor: '#FFFFFF',
    padding: 20,
    paddingBottom: 34,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '82%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#161C44',
  },
  modalClose: {
    fontSize: 30,
    color: '#696D82',
  },
  savedAccount: {
    borderWidth: 1,
    borderColor: '#E8E2F1',
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  savedAccountMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bankAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#12183F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  savedAccountLabel: {
    fontSize: 16,
    fontWeight: '900',
    color: '#161C44',
  },
  savedAccountDetail: {
    fontSize: 13,
    color: '#777B8E',
    marginTop: 2,
  },
  defaultBadge: {
    color: '#5E38D8',
    backgroundColor: '#EEE8FF',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontWeight: '800',
    fontSize: 11,
  },
  deleteAccount: {
    textAlign: 'right',
    color: '#B54C5A',
    fontWeight: '800',
  },
});
