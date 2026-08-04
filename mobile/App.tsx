import { useEffect, useMemo, useRef, useState } from 'react';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import type { ReceiptItem, TransferData } from './src/types';
import { formatClp } from './src/utils/money';
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

useEffect(() => {
  requestAnimationFrame(() => {
    scrollRef.current?.scrollTo({
      y: 0,
      animated: true,
    });
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
      const asset = Asset.fromModule(TEST_RECEIPT_MODULE);

      if (!asset.localUri) {
        await asset.downloadAsync();
      }

      const uri = asset.localUri || asset.uri;

      if (!uri) {
        throw new Error('No se pudo obtener la imagen de prueba.');
      }

      selectImage(uri, 'image/jpeg');
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

            <View style={styles.chips}>
              {people.map((person) => (
                <Pressable
                  key={person}
                  style={styles.chip}
                  onPress={() =>
                    setPeople((current) =>
                      current.filter((x) => x !== person),
                    )
                  }
                >
                  <Text style={styles.chipText}>{person} ×</Text>
                </Pressable>
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
                  {people.map((person) => {
                    const selected = (
                      assignments[item.id] || []
                    ).includes(person);

                    return (
                      <Pressable
                        key={person}
                        style={[
                          styles.personChip,
                          selected && styles.personChipSelected,
                        ]}
                        onPress={() =>
                          toggleAssignment(item.id, person)
                        }
                      >
                        <Text
                          style={[
                            styles.personChipText,
                            selected && styles.personChipTextSelected,
                          ]}
                        >
                          {person}
                        </Text>
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
              {people.map((person) => (
                <Pressable
                  key={person}
                  style={[
                    styles.personChip,
                    payer === person && styles.personChipSelected,
                  ]}
                  onPress={() => setPayer(person)}
                >
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
<View style={styles.transferBox}>
  <TextInput
    style={styles.input}
    placeholder="Banco — Ej: BancoEstado"
    placeholderTextColor="#92929A"
    value={transfer.bank}
    onChangeText={(bank) =>
      setTransfer((current) => ({ ...current, bank }))
    }
  />

  <TextInput
    style={styles.input}
    placeholder="Tipo de cuenta — Ej: Cuenta RUT"
    placeholderTextColor="#92929A"
    value={transfer.accountType}
    onChangeText={(accountType) =>
      setTransfer((current) => ({ ...current, accountType }))
    }
  />

  <TextInput
    style={styles.input}
    placeholder="Número de cuenta — Ej: 12345678"
    placeholderTextColor="#92929A"
    keyboardType="number-pad"
    value={transfer.accountNumber}
    onChangeText={(accountNumber) =>
      setTransfer((current) => ({ ...current, accountNumber }))
    }
  />

  <TextInput
    style={styles.input}
    placeholder="RUT — Ej: 12.345.678-9"
    placeholderTextColor="#92929A"
    autoCapitalize="characters"
    value={transfer.rut}
    onChangeText={(rut) =>
      setTransfer((current) => ({ ...current, rut }))
    }
  />
</View>
                   )}

            <View style={styles.summaryBox}>
              {people.map((person) => (
                <View key={person} style={styles.spaceBetween}>
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
    </KeyboardAvoidingView>
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
  label: { fontSize: 15, color: '#4F4F57', fontWeight: '800' },
  transferBox: {
    gap: 10,
    backgroundColor: '#F5F4F1',
    padding: 12,
    borderRadius: 16,
  },
  summaryBox: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFF1ED',
  },
  summaryPerson: { fontSize: 16, fontWeight: '700' },
  summaryAmount: { fontSize: 17, fontWeight: '900' },
});
