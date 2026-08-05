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
import { Card, PrimaryButton, SecondaryButton } from './src/components/Ui';
import { analyzeReceipt } from './src/services/api';
import {
  deleteTransferAccount,
  loadTransferAccounts,
  saveTransferAccount,
  type SavedTransferAccount,
} from './src/services/transferAccounts';
import type { ReceiptItem, TransferData } from './src/types';
import { formatClp } from './src/utils/money';
import { parseTransferText } from './src/utils/transferParser';
import { shareOnWhatsApp } from './src/utils/share';

const STEPS = ['Boleta', 'Productos', 'Personas', 'Reparto', 'Cobro'];

const TEST_RECEIPT_MODULE = require('./assets/test/boleta-irish-geopub.jpg');

const TEST_RECEIPT_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_TEST_RECEIPT === 'true';

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
  const [newPerson, setNewPerson] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [payer, setPayer] = useState('');
  const [tipPercent, setTipPercent] = useState('10');
  const [includeTransfer, setIncludeTransfer] = useState(true);
  const [transfer, setTransfer] = useState<TransferData>({
    bank: '',
    accountType: '',
    accountNumber: '',
    rut: '',
  });
  const [savedAccounts, setSavedAccounts] = useState<SavedTransferAccount[]>([]);
  const [accountsModalVisible, setAccountsModalVisible] = useState(false);
  const [saveAccountModalVisible, setSaveAccountModalVisible] = useState(false);
  const [accountLabel, setAccountLabel] = useState('');

  useEffect(() => {
    loadTransferAccounts()
      .then((accounts) => {
        setSavedAccounts(accounts);
        const preferred = accounts.find((account) => account.isDefault) ?? accounts[0];
        if (preferred) setTransfer(preferred.transfer);
      })
      .catch((error) => console.error('[Cuánto Pago] Error cargando cuentas:', error));
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

  /**
   * Carga una boleta incluida dentro de la app.
   * Se usa para Firebase Test Lab y pruebas automatizadas, sin cámara ni galería.
   */
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
    if (!imageUri) return;

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

  const addPerson = () => {
    const clean = newPerson.trim();
    if (!clean || people.includes(clean)) return;

    setPeople((current) => [...current, clean]);
    setNewPerson('');

    if (!payer) setPayer(clean);
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
    if (payer === person) setPayer('');
  };

  const totals = useMemo(() => {
    const base = Object.fromEntries(
      people.map((person) => [person, 0]),
    ) as Record<string, number>;

    for (const item of items) {
      const consumers = assignments[item.id] || [];
      if (!consumers.length) continue;

      for (const person of consumers) {
        base[person] += item.price / consumers.length;
      }
    }

    const tip = Math.max(0, Number(tipPercent) || 0);

    return Object.fromEntries(
      Object.entries(base).map(([person, value]) => [
        person,
        value * (1 + tip / 100),
      ]),
    );
  }, [assignments, items, people, tipPercent]);

  const totalReceipt = items.reduce(
    (sum, item) => sum + Number(item.price || 0),
    0,
  );

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
      : `🔹 ${person}: ${formatClp(totals[person] || 0)}`,
  )
  .join('\n')}`;

  const pasteTransferData = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        Alert.alert('Portapapeles vacío', 'Copia primero los datos desde la aplicación de tu banco.');
        return;
      }

      const parsed = parseTransferText(text);
      const detectedCount = Object.values(parsed).filter(Boolean).length;
      if (!detectedCount) {
        Alert.alert('No pudimos reconocer los datos', 'Completa manualmente lo que falte.');
        return;
      }

      setTransfer((current) => ({
        bank: parsed.bank || current.bank,
        accountType: parsed.accountType || current.accountType,
        accountNumber: parsed.accountNumber || current.accountNumber,
        rut: parsed.rut || current.rut,
      }));
      Alert.alert('Datos detectados', 'Revisa los campos antes de compartirlos.');
    } catch (error) {
      Alert.alert('No se pudo leer el portapapeles', error instanceof Error ? error.message : 'Error desconocido');
    }
  };

  const openSaveAccount = () => {
    if (!transfer.bank.trim() || !transfer.accountType.trim() || !transfer.accountNumber.trim() || !transfer.rut.trim()) {
      Alert.alert('Faltan datos', 'Completa banco, tipo de cuenta, número y RUT antes de guardar.');
      return;
    }
    setAccountLabel(savedAccounts.length ? `Cuenta ${savedAccounts.length + 1}` : 'Cuenta principal');
    setSaveAccountModalVisible(true);
  };

  const confirmSaveAccount = async () => {
    const label = accountLabel.trim();
    if (!label) return;
    try {
      const updated = await saveTransferAccount({ label, transfer, isDefault: savedAccounts.length === 0 });
      setSavedAccounts(updated);
      setSaveAccountModalVisible(false);
      setAccountLabel('');
      Alert.alert('Cuenta guardada', 'Podrás reutilizarla en futuras cuentas.');
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Error desconocido');
    }
  };

  const selectSavedAccount = (account: SavedTransferAccount) => {
    setTransfer(account.transfer);
    setAccountsModalVisible(false);
  };

  const removeSavedAccount = async (id: string) => {
    try {
      const updated = await deleteTransferAccount(id);
      setSavedAccounts(updated);
    } catch (error) {
      Alert.alert('No se pudo eliminar', error instanceof Error ? error.message : 'Error desconocido');
    }
  };

  const reset = () => {
    setStep(0);
    setImageUri(null);
    setItems([]);
    setPeople([]);
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
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DIVIDE SIN ENREDOS</Text>
            <Text style={styles.title}>Cuánto Pago</Text>
          </View>
          <Text style={styles.stepCount}>{step + 1}/5</Text>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${((step + 1) / 5) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.stepLabel}>{STEPS[step]}</Text>

        {step === 0 && (
          <Card>
            <Text style={styles.cardTitle}>Sube la boleta</Text>
            <Text style={styles.muted}>
              Toma una foto clara o selecciona una imagen desde tu galería.
            </Text>

            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.receiptImage} />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>🧾</Text>
              </View>
            )}

            <View style={styles.row}>
              <View style={styles.flex}>
                <SecondaryButton
                  label="📷 Cámara"
                  onPress={() => pickImage(true)}
                />
              </View>
              <View style={styles.flex}>
                <SecondaryButton
                  label="🖼️ Galería"
                  onPress={() => pickImage(false)}
                />
              </View>
            </View>

            {TEST_RECEIPT_ENABLED && (
              <SecondaryButton
                label={
                  loadingTestReceipt
                    ? 'Cargando boleta de prueba…'
                    : '🧪 Probar con boleta de ejemplo'
                }
                onPress={loadTestReceipt}
                disabled={loadingTestReceipt || loading}
              />
            )}

            {loading ? (
              <ActivityIndicator size="large" />
            ) : (
              <PrimaryButton
                label="Leer boleta con Gemini"
                onPress={scan}
                disabled={!imageUri}
              />
            )}
          </Card>
        )}

        {step === 1 && (
          <Card>
            <Text style={styles.cardTitle}>Revisa los productos</Text>
            <Text style={styles.muted}>
              Corrige nombres o precios antes de continuar.
            </Text>

            {items.map((item) => (
              <View key={item.id} style={styles.itemEditor}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Producto"
                  value={item.name}
                  onChangeText={(name) =>
                    setItems((current) =>
                      current.map((x) =>
                        x.id === item.id ? { ...x, name } : x,
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
                      current.map((x) =>
                        x.id === item.id
                          ? {
                              ...x,
                              price:
                                Number(value.replace(/\D/g, '')) || 0,
                            }
                          : x,
                      ),
                    )
                  }
                />
                <Pressable
                  onPress={() =>
                    setItems((current) =>
                      current.filter((x) => x.id !== item.id),
                    )
                  }
                >
                  <Text style={styles.delete}>×</Text>
                </Pressable>
              </View>
            ))}

            <SecondaryButton label="＋ Agregar producto" onPress={addItem} />
            <Text style={styles.total}>
              Total leído: {formatClp(totalReceipt)}
            </Text>
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
                  <Text style={styles.personName}>{person}</Text>
                  {payer === person && <Text style={styles.payerBadge}>Pagó</Text>}
                  <Pressable onPress={() => removePerson(person)} hitSlop={10}>
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
            <Text style={styles.cardTitle}>Reparte cada consumo</Text>

            {items.map((item) => (
              <View key={item.id} style={styles.assignmentCard}>
                <View style={styles.spaceBetween}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemPrice}>{formatClp(item.price)}</Text>
                </View>

                <View style={styles.chips}>
                  {people.map((person, index) => {
                    const selected = (assignments[item.id] || []).includes(person);

                    return (
                      <Pressable
                        key={`${person}-${index}`}
                        style={[styles.personChip, selected && styles.personChipSelected]}
                        onPress={() =>
                          toggleAssignment(item.id, person)
                        }
                      >
                        <PersonAvatar name={person} index={index} size={26} selected={selected} />
                        <Text
                          style={[
                            styles.personChipText,
                            selected && styles.personChipTextSelected,
                          ]}
                        >
                          {person}
                        </Text>
                        {selected && <Text style={styles.personChipCheck}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </View>
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
          <Card>
            <Text style={styles.cardTitle}>Resumen y cobro</Text>
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
                  <PersonAvatar name={person} index={index} size={26} selected={payer === person} />
                  <Text
                    style={[
                      styles.personChipText,
                      payer === person && styles.personChipTextSelected,
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
              />
            </View>

            {includeTransfer && (
              <>
                <View style={styles.transferActions}>
                  <View style={styles.flex}>
                    <SecondaryButton label="📋 Pegar desde banco" onPress={pasteTransferData} />
                  </View>
                  <View style={styles.flex}>
                    <SecondaryButton label="🏦 Mis cuentas" onPress={() => setAccountsModalVisible(true)} />
                  </View>
                </View>
                <View style={styles.transferBox}>
                  <TextInput style={styles.input} placeholder="Banco — Ej: BancoEstado" placeholderTextColor="#92929A" value={transfer.bank} onChangeText={(bank) => setTransfer((x) => ({ ...x, bank }))} />
                  <TextInput style={styles.input} placeholder="Tipo de cuenta — Ej: Cuenta RUT" placeholderTextColor="#92929A" value={transfer.accountType} onChangeText={(accountType) => setTransfer((x) => ({ ...x, accountType }))} />
                  <TextInput style={styles.input} placeholder="Número de cuenta — Ej: 12345678" placeholderTextColor="#92929A" keyboardType="number-pad" value={transfer.accountNumber} onChangeText={(accountNumber) => setTransfer((x) => ({ ...x, accountNumber }))} />
                  <TextInput style={styles.input} placeholder="RUT — Ej: 12.345.678-9" placeholderTextColor="#92929A" autoCapitalize="characters" value={transfer.rut} onChangeText={(rut) => setTransfer((x) => ({ ...x, rut }))} />
                  <SecondaryButton label="Guardar en Mis cuentas" onPress={openSaveAccount} />
                  <Text style={styles.localDataHint}>🔒 Se guarda solo en este dispositivo.</Text>
                </View>
              </>
            )}

            <View style={styles.summaryBox}>
              {people.map((person, index) => (
                <View key={`${person}-${index}`} style={styles.summaryRow}>
                  <PersonAvatar name={person} index={index} size={34} />
                  <Text style={styles.summaryPerson}>
                    {person}
                    {person === payer ? ' (pagó)' : ''}
                  </Text>
                  <Text style={styles.summaryAmount}>
                    {formatClp(totals[person] || 0)}
                  </Text>
                </View>
              ))}
            </View>

            <PrimaryButton
              label="Compartir resumen grupal"
              onPress={() =>
                shareOnWhatsApp(groupMessage).catch((error) =>
                  Alert.alert('Error', error.message),
                )
              }
            />

            {includeTransfer && (
              <SecondaryButton
                label="Compartir datos de transferencia"
                onPress={() =>
                  shareOnWhatsApp(transferMessage).catch((error) =>
                    Alert.alert('Error', error.message),
                  )
                }
              />
            )}

            {people
              .filter((person) => person !== payer)
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
                      includeTransfer ? `\n\n${transferMessage}` : ''
                    }`;

                    shareOnWhatsApp(message).catch((error) =>
                      Alert.alert('Error', error.message),
                    );
                  }}
                />
              ))}

            <NavButtons
              back={() => setStep(3)}
              next={reset}
              nextLabel="Nueva cuenta"
            />
          </Card>
        )}
      </ScrollView>

      <Modal visible={accountsModalVisible} transparent animationType="slide" onRequestClose={() => setAccountsModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.spaceBetween}>
              <Text style={styles.modalTitle}>Mis cuentas</Text>
              <Pressable onPress={() => setAccountsModalVisible(false)} hitSlop={10}><Text style={styles.modalClose}>×</Text></Pressable>
            </View>
            {!savedAccounts.length ? (
              <Text style={styles.muted}>Aún no tienes cuentas guardadas. Completa los datos y pulsa “Guardar en Mis cuentas”.</Text>
            ) : savedAccounts.map((account) => (
              <View key={account.id} style={styles.savedAccount}>
                <Pressable style={styles.savedAccountMain} onPress={() => selectSavedAccount(account)}>
                  <View style={styles.bankAvatar}><Text style={styles.bankAvatarText}>{account.label.charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.flex}>
                    <Text style={styles.savedAccountLabel}>{account.label}</Text>
                    <Text style={styles.savedAccountDetail}>{account.transfer.bank} · {account.transfer.accountType}</Text>
                    <Text style={styles.savedAccountDetail}>••••{account.transfer.accountNumber.slice(-4)}</Text>
                  </View>
                  {account.isDefault && <Text style={styles.defaultBadge}>Principal</Text>}
                </Pressable>
                <Pressable onPress={() => Alert.alert('Eliminar cuenta', `¿Eliminar “${account.label}”?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => removeSavedAccount(account.id) }])}>
                  <Text style={styles.deleteAccount}>Eliminar</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      <Modal visible={saveAccountModalVisible} transparent animationType="fade" onRequestClose={() => setSaveAccountModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Guardar cuenta</Text>
            <Text style={styles.muted}>Ponle un nombre fácil de reconocer.</Text>
            <TextInput style={styles.input} placeholder="Ej: Cuenta personal" value={accountLabel} onChangeText={setAccountLabel} autoFocus />
            <View style={styles.row}>
              <View style={styles.flex}><SecondaryButton label="Cancelar" onPress={() => setSaveAccountModalVisible(false)} /></View>
              <View style={styles.flex}><PrimaryButton label="Guardar" onPress={confirmSaveAccount} disabled={!accountLabel.trim()} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function PersonAvatar({ name, index, size = 36, selected = false }: { name: string; index: number; size?: number; selected?: boolean }) {
  const colors = ['#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#D97706', '#0891B2', '#4F46E5', '#059669'];
  const color = colors[index % colors.length];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: selected ? '#FFFFFF' : color }]}>
      <Text style={[styles.avatarText, { fontSize: Math.max(12, size * 0.42), color: selected ? '#0D1B2A' : '#FFFFFF' }]}>{initial}</Text>
    </View>
  );
}

function NavButtons({
  back,
  next,
  nextDisabled = false,
  nextLabel = 'Siguiente',
}: {
  back: () => void;
  next: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <SecondaryButton label="Atrás" onPress={back} />
      </View>
      <View style={styles.flex}>
        <PrimaryButton
          label={nextLabel}
          onPress={next}
          disabled={nextDisabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F5F2' },
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 48, gap: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2.2,
    color: '#797981',
    fontWeight: '800',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#17171B',
    marginTop: 3,
  },
  stepCount: { fontSize: 15, fontWeight: '800', color: '#5E5E67' },
  progressTrack: {
    height: 7,
    borderRadius: 10,
    backgroundColor: '#E0DFDB',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#FF6B4A' },
  stepLabel: { color: '#5E5E67', fontWeight: '700', marginBottom: 4 },
  cardTitle: { fontSize: 23, fontWeight: '900', color: '#19191F' },
  muted: { fontSize: 15, lineHeight: 21, color: '#6D6D75' },
  receiptImage: {
    width: '100%',
    height: 300,
    borderRadius: 16,
    resizeMode: 'contain',
    backgroundColor: '#F0F0F0',
  },
  placeholder: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F2EF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DFDED9',
    borderStyle: 'dashed',
  },
  placeholderText: { fontSize: 64 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#DAD9DE',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#1F1F24',
  },
  priceInput: { width: 112 },
  itemEditor: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  delete: { fontSize: 30, color: '#B54A43', paddingHorizontal: 4 },
  total: { fontSize: 18, fontWeight: '900', textAlign: 'right' },
  addButton: {
    height: 50,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#FF6B4A',
    justifyContent: 'center',
  },
  addButtonText: { color: 'white', fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  peopleList: { gap: 8 },
  personRow: { flexDirection: 'row', alignItems: 'center', minHeight: 54, gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ECEBF0' },
  personName: { flex: 1, fontSize: 16, fontWeight: '800' },
  payerBadge: { color: '#087F5B', backgroundColor: '#DDF7EE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontWeight: '800', fontSize: 12 },
  removePerson: { fontSize: 26, color: '#A1443E' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '900' },
  chip: {
    backgroundColor: '#EEEDE9',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  chipText: { color: '#33333A', fontWeight: '700' },
  assignmentCard: {
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEBF0',
  },
  spaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  itemName: { fontSize: 17, fontWeight: '800', flex: 1 },
  itemPrice: { fontSize: 16, fontWeight: '800' },
  personChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D5D4D9',
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  personChipSelected: {
    backgroundColor: '#19191F',
    borderColor: '#19191F',
  },
  personChipText: { color: '#414149', fontWeight: '700' },
  personChipTextSelected: { color: '#FFFFFF' },
  personChipCheck: { color: '#64E8CD', fontWeight: '900' },
  label: { fontSize: 15, color: '#4F4F57', fontWeight: '800' },
  transferActions: { flexDirection: 'row', gap: 10 },
  transferBox: {
    gap: 10,
    backgroundColor: '#F5F4F1',
    padding: 12,
    borderRadius: 16,
  },
  localDataHint: { textAlign: 'center', color: '#6D6D75', fontSize: 12, fontWeight: '700' },
  summaryBox: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFF1ED',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryPerson: { fontSize: 16, fontWeight: '700', flex: 1 },
  summaryAmount: { fontSize: 17, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13,27,42,0.45)' },
  modalCard: { gap: 14, backgroundColor: '#FFFFFF', padding: 20, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#17202A' },
  modalClose: { fontSize: 30, color: '#59636E' },
  savedAccount: { borderWidth: 1, borderColor: '#E1E5E8', borderRadius: 16, padding: 12, gap: 8 },
  savedAccountMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bankAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0D1B2A', alignItems: 'center', justifyContent: 'center' },
  bankAvatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  savedAccountLabel: { fontSize: 16, fontWeight: '900', color: '#17202A' },
  savedAccountDetail: { fontSize: 13, color: '#6D6D75', marginTop: 2 },
  defaultBadge: { color: '#087F5B', backgroundColor: '#DDF7EE', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontWeight: '800', fontSize: 11 },
  deleteAccount: { textAlign: 'right', color: '#A1443E', fontWeight: '800' },
});
