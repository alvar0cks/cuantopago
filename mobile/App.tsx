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
import { initializeAdMob } from './src/services/adMob';
import {
  deleteTransferAccount,
  loadTransferAccounts,
  saveTransferAccount,
  type SavedTransferAccount,
} from './src/services/transferAccounts';
import type { ReceiptItem, TransferData } from './src/types';
import { formatClp } from './src/utils/money';
import { shareImage, shareOnWhatsApp } from './src/utils/share';
import { captureRef } from 'react-native-view-shot';
import { parseTransferText } from './src/utils/transferParser';

const STEPS = ['Boleta', 'Productos', 'Personas', 'Reparto', 'Cobro'];
const STEP_ICONS = ['', '✓', '👥', '↗', '$'];
const TEST_RECEIPT_MODULE = require('./assets/test/boleta-irish-geopub.jpg');
const TEST_RECEIPT_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_TEST_RECEIPT === 'true';

const EMPTY_TRANSFER: TransferData = {
  bank: '',
  accountType: '',
  accountNumber: '',
  rut: '',
};

type TipMode = 'proportional' | 'equal';

function reconcileRoundedTotals(
  rawTotals: Record<string, number>,
  targetTotal: number,
): Record<string, number> {
  const entries = Object.entries(rawTotals);
  if (!entries.length) return {};

  const floored = Object.fromEntries(
    entries.map(([person, value]) => [person, Math.max(0, Math.floor(value))]),
  ) as Record<string, number>;

  let remaining = Math.max(0, Math.round(targetTotal)) - Object.values(floored).reduce((sum, value) => sum + value, 0);

  const byRemainder = entries
    .map(([person, value]) => ({ person, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  let index = 0;
  while (remaining > 0 && byRemainder.length) {
    floored[byRemainder[index % byRemainder.length].person] += 1;
    remaining -= 1;
    index += 1;
  }

  return floored;
}

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
  const shareImageRef = useRef<View>(null);

  const [isHome, setIsHome] = useState(true);
  const [step, setStep] = useState(0);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [scanTakingLong, setScanTakingLong] = useState(false);
  const [loadingTestReceipt, setLoadingTestReceipt] = useState(false);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [invitedPeople, setInvitedPeople] = useState<string[]>([]);
  const [newPerson, setNewPerson] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [payer, setPayer] = useState('');
  const [tipPercent, setTipPercent] = useState('10');
  const [tipMode, setTipMode] = useState<TipMode>('proportional');
  const [detectedTipAmount, setDetectedTipAmount] = useState<number | null>(null);
  const [useDetectedTip, setUseDetectedTip] = useState(false);
  const [includeTransfer, setIncludeTransfer] = useState(true);
  const [transfer, setTransfer] = useState<TransferData>(EMPTY_TRANSFER);

  const [savedAccounts, setSavedAccounts] = useState<SavedTransferAccount[]>([]);
  const [accountsModalVisible, setAccountsModalVisible] = useState(false);
  const [saveAccountModalVisible, setSaveAccountModalVisible] = useState(false);
  const [accountLabel, setAccountLabel] = useState('');
  const [expandedPeople, setExpandedPeople] = useState<Record<string, boolean>>({});
  const [sharePreviewVisible, setSharePreviewVisible] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const [detailSectionOpen, setDetailSectionOpen] = useState(false);
  const [chargeSectionOpen, setChargeSectionOpen] = useState(false);

  useEffect(() => {
    void initializeAdMob();
  }, []);

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

  useEffect(() => {
    if (!loading) {
      setScanTakingLong(false);
      return;
    }

    const timeout = setTimeout(() => {
      setScanTakingLong(true);
    }, 8000);

    return () => clearTimeout(timeout);
  }, [loading]);

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

      const scannedTip =
        result.tip == null ? null : Math.max(0, Math.round(Number(result.tip) || 0));
      setDetectedTipAmount(scannedTip);
      setUseDetectedTip(scannedTip != null);

      if (scannedTip != null) {
        const scannedBase = (result.items || []).reduce(
          (sum, item) => sum + Number(item.price || 0),
          0,
        );
        if (scannedBase > 0) {
          const detectedPercent = (scannedTip / scannedBase) * 100;
          setTipPercent(
            Math.abs(detectedPercent - Math.round(detectedPercent)) < 0.05
              ? String(Math.round(detectedPercent))
              : detectedPercent.toFixed(2),
          );
        }
      }

      setStep(1);
    } catch (error) {
      if (__DEV__){
          console.error('Error al leer la boleta:', error);
      }
      

      const code = error instanceof Error ? error.message : 'ANALYSIS_ERROR';
      const message =
        code === 'NETWORK_ERROR'
          ? 'Se perdió la conexión mientras procesábamos la boleta. Revisa tu conexión e inténtalo nuevamente.'
          : code === 'SERVICE_BUSY'
            ? 'El servicio está un poco ocupado en este momento. Inténtalo nuevamente en unos segundos.'
            : code === 'CONFIG_ERROR'
              ? 'El servicio de lectura no está disponible en este momento. Inténtalo más tarde.'
              : 'Tuvimos un problema al procesar la boleta. Inténtalo nuevamente.';

      Alert.alert('No pudimos leer la boleta', message, [
        { text: 'Entendido' },
      ]);
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
    const baseTotal = Object.values(adjusted).reduce(
      (sum, value) => sum + value,
      0,
    );

    const calculatedTipAmount = Math.max(0, Math.round(baseTotal * tip / 100));
    const tipAmount =
      useDetectedTip && detectedTipAmount != null
        ? detectedTipAmount
        : calculatedTipAmount;

    const payingPeople = people.filter((person) => !invitedSet.has(person));
    const rawTotals = Object.fromEntries(
      people.map((person) => {
        const base = adjusted[person] || 0;
        let personTip = 0;

        if (tipMode === 'equal') {
          if (payingPeople.includes(person) && payingPeople.length > 0) {
            personTip = tipAmount / payingPeople.length;
          }
        } else if (baseTotal > 0) {
          personTip = tipAmount * (base / baseTotal);
        }

        return [person, base + personTip];
      }),
    ) as Record<string, number>;

    const targetTotal = Math.round(baseTotal + tipAmount);
    const totals = reconcileRoundedTotals(rawTotals, targetTotal);

    return {
      totals,
      invitationShare,
      ownConsumption,
      baseTotal,
      tipAmount,
      targetTotal,
    };
  }, [
    assignments,
    detectedTipAmount,
    invitedPeople,
    items,
    people,
    tipMode,
    tipPercent,
    useDetectedTip,
  ]);

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

  const groupMessage = `¡Hola! Resumen de la cuenta (incluye ${
    Number(tipPercent) || 0
  }% de propina · ${tipMode === 'equal' ? 'partes iguales' : 'proporcional'} · ${formatClp(billBreakdown.tipAmount)}):

${people
  .map((person) =>
    person === payer
      ? `✅ ${person} (pagó) — Consumo: ${formatClp(totals[person] || 0)}`
      : invitedPeople.includes(person)
        ? `🎁 ${person}: Invitado por el grupo — ${formatClp(totals[person] || 0)}`
        : `🔹 ${person}: ${formatClp(totals[person] || 0)}`,
  )
  .join('\n')}`;

  const getPersonItemDetails = (person: string) => {
    const rawLines = items.flatMap((item) => {
      const consumers = assignments[item.id] || [];
      if (!consumers.includes(person) || !consumers.length) return [];

      return [{
        name: item.name,
        amount: Number(item.price || 0) / consumers.length,
        sharedBy: consumers.length,
      }];
    });

    // Ajusta el redondeo de las líneas para que el detalle de consumo
    // cuadre exactamente con el consumo personal mostrado por la app.
    const target = Math.round(billBreakdown.ownConsumption[person] || 0);
    const rounded = rawLines.map((line) => ({
      ...line,
      roundedAmount: Math.floor(Math.max(0, line.amount)),
      remainder: line.amount - Math.floor(line.amount),
    }));

    let remaining = target - rounded.reduce(
      (sum, line) => sum + line.roundedAmount,
      0,
    );

    const order = rounded
      .map((line, index) => ({ index, remainder: line.remainder }))
      .sort((a, b) => b.remainder - a.remainder);

    let index = 0;
    while (remaining > 0 && order.length) {
      rounded[order[index % order.length].index].roundedAmount += 1;
      remaining -= 1;
      index += 1;
    }

    return rounded;
  };

  const buildPersonDetail = (person: string) => {
    const itemDetails = getPersonItemDetails(person);
    const ownConsumption = Math.round(billBreakdown.ownConsumption[person] || 0);
    const invitation = Math.round(billBreakdown.invitationShare[person] || 0);
    const total = Math.round(totals[person] || 0);
    const isInvited = invitedPeople.includes(person);
    const tipAmount = isInvited
      ? 0
      : Math.max(0, total - ownConsumption - invitation);

    const itemLines = itemDetails.length
      ? itemDetails
          .map((line) => {
            const shared = line.sharedBy > 1 ? ` (tu parte de ${line.sharedBy})` : '';
            return `  • ${line.name}${shared}: ${formatClp(line.roundedAmount)}`;
          })
          .join('\n')
      : '  • Sin productos asignados';

    if (isInvited) {
      return `🎁 ${person} — invitado por el grupo\n${itemLines}\n  Total a pagar: ${formatClp(0)}`;
    }

    const extras = [
      invitation > 0 ? `  • Invitación del grupo: ${formatClp(invitation)}` : '',
      tipAmount > 0 ? `  • Propina: ${formatClp(tipAmount)}` : '',
    ].filter(Boolean).join('\n');

    return `${person}${person === payer ? ' (pagó)' : ''}\n${itemLines}${extras ? `\n${extras}` : ''}\n  Total: ${formatClp(total)}`;
  };

  const detailedGroupMessage = `🧾 *Detalle de la cuenta*\nTotal: ${formatClp(
    billBreakdown.targetTotal,
  )}\nPagó: ${payer || 'Sin definir'}\n\n${people
    .map(buildPersonDetail)
    .join('\n\n')}\n\nGenerado con Cuánto Pago`;

  const buildChargeMessage = (person: string) => {
    const detail = buildPersonDetail(person);
    return `¡Hola ${person}! 👋\nTe comparto el detalle de tu parte de la cuenta:\n\n${detail}\n\nTotal a transferir: ${formatClp(
      totals[person] || 0,
    )}${includeTransfer ? `\n\n${transferMessage}` : ''}`;
  };

  const allPeopleExpanded = people.length > 0 && people.every(
    (person) => expandedPeople[person],
  );

  const togglePersonDetail = (person: string) => {
    setExpandedPeople((current) => ({ ...current, [person]: !current[person] }));
  };

  const toggleAllPeopleDetails = () => {
    const nextValue = !allPeopleExpanded;
    setExpandedPeople(Object.fromEntries(people.map((person) => [person, nextValue])));
  };


  const shareDetailedSummaryImage = async () => {
    if (!shareImageRef.current) return;
    try {
      setSharingImage(true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      // Exportamos a mayor ancho, pero NO forzamos la altura.
      // view-shot conserva la proporción real del resumen y evita crear
      // el lienzo negro gigante que aparecía en iOS al fijar width + height.
      const targetWidth = 1080;
      const uri = await captureRef(shareImageRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: targetWidth,
        ...(Platform.OS === 'ios' ? { useRenderInContext: true } : {}),
      });
      await shareImage(uri);
    } catch (error) {
      console.log('[Cuánto Pago] Error compartiendo imagen:', error);
      Alert.alert('No pudimos compartir el resumen', 'Inténtalo nuevamente en unos segundos.');
    } finally {
      setSharingImage(false);
    }
  };

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
    setTipPercent('10');
    setTipMode('proportional');
    setDetectedTipAmount(null);
    setUseDetectedTip(false);
    setExpandedPeople({});
    setSharePreviewVisible(false);
    setDetailSectionOpen(false);
    setChargeSectionOpen(false);
  };

  if (isHome) {
    return (
      <View style={styles.homeScreen}>
        <ScrollView
          contentContainerStyle={styles.homeContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.homeHeader}>
            <View style={styles.homeBrandWrap}>
              <Image source={require('./assets/cuanto-pago-logo.png')} style={styles.homeLogoImage} />
              <Text style={styles.homeBrand}>Cuánto Pago</Text>
            </View>
            <View style={styles.homeProfileButton}>
              <Text style={styles.homeProfileIcon}>♙</Text>
            </View>
          </View>

          <View style={styles.homeHero}>
            <Text style={styles.homeHeroTitle}>La forma más fácil</Text>
            <Text style={styles.homeHeroAccent}>de dividir cuentas</Text>
            <Text style={styles.homeHeroText}>
              Escanea una boleta, asigna lo que consumió cada persona y descubre cuánto debe pagar cada uno en segundos.
            </Text>
          </View>

          <View style={styles.homeInfoCard}>
            <View style={styles.homeShield}>
              <Text style={styles.homeShieldIcon}>✓</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.homeInfoTitle}>Sin registro</Text>
              <Text style={styles.homeInfoText}>
                Empieza a dividir la cuenta sin crear una cuenta.
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.homeScanCard,
              pressed && styles.homePressed,
            ]}
            onPress={() => {
              setStep(0);
              setIsHome(false);
            }}
          >
            <View style={styles.homeReceiptVisual}>
              <View style={styles.homeScanCorners}>
                <Image source={require('./assets/receipt-icon.png')} style={styles.homeReceiptIcon} />
              </View>
            </View>
            <View style={styles.homeScanCopy}>
              <Text style={styles.homeScanTitle}>Escanear{`\n`}boleta</Text>
              <Text style={styles.homeScanSubtitle}>Comienza en segundos</Text>
            </View>
            <View style={styles.homeArrowButton}>
              <Text style={styles.homeArrow}>→</Text>
            </View>
          </Pressable>
        </ScrollView>

      </View>
    );
  }

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
          <Pressable style={styles.brandWrap} onPress={() => setIsHome(true)}>
            <Image source={require('./assets/cuanto-pago-logo.png')} style={styles.logoImage} />
            <View>
              <Text style={styles.brand}>Cuánto Pago</Text>
              <Text style={styles.subtitle}>Divide sin complicaciones</Text>
            </View>
          </Pressable>
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
                  {index === 0 && !done ? (
                    <Image source={require('./assets/receipt-icon.png')} style={styles.stepReceiptIcon} />
                  ) : (
                    <Text
                      style={[
                        styles.stepCircleText,
                        (active || done) && styles.stepCircleTextActive,
                      ]}
                    >
                      {done ? '✓' : STEP_ICONS[index]}
                    </Text>
                  )}
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
                      <Image source={require('./assets/receipt-icon.png')} style={styles.receiptIllustrationIcon} />
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
                    {scanTakingLong
                      ? 'Está tomando un poco más de lo normal'
                      : 'Estamos leyendo la boleta'}
                  </Text>
                  <Text style={styles.loadingText}>
                    {scanTakingLong
                      ? 'Seguimos procesando tu boleta. No necesitas hacer nada.'
                      : 'Esto puede tardar unos segundos.'}
                  </Text>
                </View>
              ) : (
                <PrimaryButton
                  label="Leer boleta con IA"
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

            {items.some((item) => Number(item.price || 0) <= 0) && (
              <View style={styles.zeroPriceNotice}>
                <Text style={styles.zeroPriceNoticeTitle}>ℹ️ Hay productos con valor $0</Text>
                <Text style={styles.zeroPriceNoticeText}>No se incluirán en el reparto y se quitarán automáticamente al continuar.</Text>
              </View>
            )}

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
              next={() => {
                setItems((current) => current.filter((item) => Number(item.price || 0) > 0));
                setStep(2);
              }}
              nextDisabled={
                !items.some((item) => Number(item.price || 0) > 0) ||
                items.some((item) => Number(item.price || 0) > 0 && !item.name.trim())
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
                keyboardType="decimal-pad"
                value={tipPercent}
                onChangeText={(value) => {
                  setTipPercent(value);
                  setUseDetectedTip(false);
                }}
              />

              {detectedTipAmount != null && (
                <Pressable
                  style={styles.detectedTipRow}
                  onPress={() => setUseDetectedTip((current) => !current)}
                >
                  <View style={styles.flex}>
                    <Text style={styles.detectedTipTitle}>
                      Propina detectada en la boleta: {formatClp(detectedTipAmount)}
                    </Text>
                    <Text style={styles.detectedTipHint}>
                      {useDetectedTip
                        ? 'Se usará el monto exacto impreso en la boleta.'
                        : 'Toca aquí para volver a usar el monto exacto de la boleta.'}
                    </Text>
                  </View>
                  <Text style={styles.detectedTipCheck}>
                    {useDetectedTip ? '✓' : '○'}
                  </Text>
                </Pressable>
              )}

              <Text style={styles.label}>¿Cómo dividir la propina?</Text>
              <View style={styles.tipModeRow}>
                <Pressable
                  style={[
                    styles.tipModeOption,
                    tipMode === 'proportional' && styles.tipModeOptionSelected,
                  ]}
                  onPress={() => setTipMode('proportional')}
                >
                  <Text
                    style={[
                      styles.tipModeTitle,
                      tipMode === 'proportional' && styles.tipModeTextSelected,
                    ]}
                  >
                    Proporcional
                  </Text>
                  <Text
                    style={[
                      styles.tipModeSubtitle,
                      tipMode === 'proportional' && styles.tipModeTextSelected,
                    ]}
                  >
                    Cada uno paga según lo que consumió
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.tipModeOption,
                    tipMode === 'equal' && styles.tipModeOptionSelected,
                  ]}
                  onPress={() => setTipMode('equal')}
                >
                  <Text
                    style={[
                      styles.tipModeTitle,
                      tipMode === 'equal' && styles.tipModeTextSelected,
                    ]}
                  >
                    Partes iguales
                  </Text>
                  <Text
                    style={[
                      styles.tipModeSubtitle,
                      tipMode === 'equal' && styles.tipModeTextSelected,
                    ]}
                  >
                    La propina se divide entre todos
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.tipSummary}>
                Propina aplicada: {formatClp(billBreakdown.tipAmount)} · Total final: {formatClp(billBreakdown.targetTotal)}
              </Text>

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
                  {formatClp(billBreakdown.targetTotal)}
                </Text>
                <Text style={styles.summaryPayer}>
                  Pagó: {payer || 'Selecciona una persona'}
                </Text>
              </View>

              <View style={styles.summaryListHeader}>
                <Text style={styles.summaryListTitle}>Detalle por persona</Text>
                <Pressable onPress={toggleAllPeopleDetails} hitSlop={8}>
                  <Text style={styles.summaryToggleAll}>{allPeopleExpanded ? 'Ocultar todos' : 'Ver todos'}</Text>
                </Pressable>
              </View>

              <View style={styles.summaryList}>
                {people.map((person, index) => {
                  const isExpanded = !!expandedPeople[person];
                  const detailItems = getPersonItemDetails(person);
                  const own = Math.round(billBreakdown.ownConsumption[person] || 0);
                  const invitation = Math.round(billBreakdown.invitationShare[person] || 0);
                  const total = Math.round(totals[person] || 0);
                  const invited = invitedPeople.includes(person);
                  const personTip = invited ? 0 : Math.max(0, total - own - invitation);
                  return (
                    <View key={`${person}-${index}`} style={styles.summaryPersonCard}>
                      <Pressable style={styles.summaryRow} onPress={() => togglePersonDetail(person)}>
                        <PersonAvatar name={person} index={index} size={36} />
                        <View style={styles.flex}>
                          <Text style={styles.summaryPerson}>{person}{person === payer ? ' (pagó)' : ''}</Text>
                          <Text style={styles.summaryDetail}>
                            {invited ? '🎁 Invitado por el grupo' : total ? 'Toca para ver qué consumió' : 'Sin deuda'}
                          </Text>
                        </View>
                        <Text style={styles.summaryAmount}>{formatClp(total)}</Text>
                        <Text style={styles.summaryChevron}>{isExpanded ? '⌃' : '⌄'}</Text>
                      </Pressable>
                      {isExpanded && (
                        <View style={styles.summaryExpanded}>
                          {detailItems.length ? detailItems.map((line, lineIndex) => (
                            <View key={`${person}-${line.name}-${lineIndex}`} style={styles.summaryLine}>
                              <Text style={styles.summaryLineLabel}>{line.name}{line.sharedBy > 1 ? ` · parte de ${line.sharedBy}` : ''}</Text>
                              <Text style={styles.summaryLineAmount}>{formatClp(line.roundedAmount)}</Text>
                            </View>
                          )) : <Text style={styles.summaryEmpty}>Sin productos asignados</Text>}
                          {invitation > 0 && <View style={styles.summaryLine}><Text style={styles.summaryLineLabel}>🎁 Parte de invitación</Text><Text style={styles.summaryLineAmount}>{formatClp(invitation)}</Text></View>}
                          {personTip > 0 && <View style={styles.summaryLine}><Text style={styles.summaryLineLabel}>Propina</Text><Text style={styles.summaryLineAmount}>{formatClp(personTip)}</Text></View>}
                          <View style={[styles.summaryLine, styles.summaryLineTotal]}><Text style={styles.summaryLineTotalText}>Total</Text><Text style={styles.summaryLineTotalText}>{formatClp(total)}</Text></View>
                        </View>
                      )}
                    </View>
                  );
                })}
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
                label="Compartir resumen"
                icon="💬"
                onPress={() => shareOnWhatsApp(groupMessage).catch((error) => Alert.alert('Error', error.message))}
              />

              <Pressable style={styles.actionSectionHeader} onPress={() => setDetailSectionOpen((value) => !value)}>
                <View style={styles.flex}>
                  <Text style={styles.actionSectionTitle}>🧾 Ver y compartir detalle</Text>
                  <Text style={styles.actionSectionHint}>Imagen y datos de transferencia</Text>
                </View>
                <Text style={styles.actionSectionChevron}>{detailSectionOpen ? '⌃' : '⌄'}</Text>
              </Pressable>
              {detailSectionOpen && (
                <View style={styles.actionSectionBody}>
                  <SecondaryButton label="Compartir detalle como imagen" icon="🧾" onPress={() => setSharePreviewVisible(true)} />
                  {includeTransfer && (
                    <SecondaryButton label="Compartir datos de transferencia" icon="🏦" onPress={() => shareOnWhatsApp(transferMessage).catch((error) => Alert.alert('Error', error.message))} />
                  )}
                </View>
              )}

              <Pressable style={styles.actionSectionHeader} onPress={() => setChargeSectionOpen((value) => !value)}>
                <View style={styles.flex}>
                  <Text style={styles.actionSectionTitle}>💸 Cobrar individualmente</Text>
                  <Text style={styles.actionSectionHint}>Envía el cobro a cada persona</Text>
                </View>
                <Text style={styles.actionSectionChevron}>{chargeSectionOpen ? '⌃' : '⌄'}</Text>
              </Pressable>
              {chargeSectionOpen && (
                <View style={styles.actionSectionBody}>
                  {people.filter((person) => person !== payer && !invitedPeople.includes(person)).map((person) => (
                    <SecondaryButton key={person} label={`Cobrar a ${person}: ${formatClp(totals[person] || 0)}`} onPress={() => shareOnWhatsApp(buildChargeMessage(person)).catch((error) => Alert.alert('Error', error.message))} />
                  ))}
                </View>
              )}

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

      <AppBanner />

      <AccountsModal
        visible={accountsModalVisible}
        accounts={savedAccounts}
        onClose={() => setAccountsModalVisible(false)}
        onSelect={selectSavedAccount}
        onDelete={removeSavedAccount}
      />

      <Modal
        visible={sharePreviewVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSharePreviewVisible(false)}
      >
        <View style={styles.sharePreviewBackdrop}>
          <ScrollView contentContainerStyle={styles.sharePreviewScroll} showsVerticalScrollIndicator={false}>
            <View ref={shareImageRef} collapsable={false} style={styles.shareImageCard}>
              <View style={styles.shareImageBrandRow}>
                <Image source={require('./assets/cuanto-pago-logo.png')} style={styles.shareImageLogo} />
                <View><Text style={styles.shareImageBrand}>Cuánto Pago</Text><Text style={styles.shareImageSubtitle}>Detalle de la cuenta</Text></View>
              </View>
              <View style={styles.shareImageTotalBox}>
                <Text style={styles.shareImageTotalLabel}>Total de la cuenta</Text>
                <Text style={styles.shareImageTotalAmount}>{formatClp(billBreakdown.targetTotal)}</Text>
                <Text style={styles.shareImagePayer}>Pagó: {payer || 'Sin definir'}</Text>
              </View>
              {people.map((person, index) => {
                const detailItems = getPersonItemDetails(person);
                const own = Math.round(billBreakdown.ownConsumption[person] || 0);
                const invitation = Math.round(billBreakdown.invitationShare[person] || 0);
                const total = Math.round(totals[person] || 0);
                const invited = invitedPeople.includes(person);
                const personTip = invited ? 0 : Math.max(0, total - own - invitation);
                return (
                  <View key={`share-${person}-${index}`} style={styles.shareImagePersonCard}>
                    <View style={styles.shareImagePersonHeader}><View style={styles.flex}><Text style={styles.shareImagePersonName}>{person}{person === payer ? ' · pagó' : ''}</Text>{invited && <Text style={styles.shareImageInvited}>🎁 Invitado por el grupo</Text>}</View><Text style={styles.shareImagePersonTotal}>{formatClp(total)}</Text></View>
                    {detailItems.map((line, lineIndex) => <View key={`share-line-${lineIndex}`} style={styles.shareImageLine}><Text style={styles.shareImageLineLabel}>{line.name}{line.sharedBy > 1 ? ` · parte de ${line.sharedBy}` : ''}</Text><Text style={styles.shareImageLineAmount}>{formatClp(line.roundedAmount)}</Text></View>)}
                    {invitation > 0 && <View style={styles.shareImageLine}><Text style={styles.shareImageLineLabel}>🎁 Parte de invitación</Text><Text style={styles.shareImageLineAmount}>{formatClp(invitation)}</Text></View>}
                    {personTip > 0 && <View style={styles.shareImageLine}><Text style={styles.shareImageLineLabel}>Propina</Text><Text style={styles.shareImageLineAmount}>{formatClp(personTip)}</Text></View>}
                  </View>
                );
              })}
              <View style={styles.shareImageRecover}><Text style={styles.shareImageRecoverLabel}>{payer || 'Quien pagó'} debe recuperar</Text><Text style={styles.shareImageRecoverAmount}>{formatClp(recoverAmount)}</Text></View>
              <Text style={styles.shareImageFooter}>Generado con Cuánto Pago</Text>
            </View>
            <View style={styles.sharePreviewActions}>
              <PrimaryButton label={sharingImage ? 'Preparando imagen…' : 'Compartir imagen'} icon="💬" disabled={sharingImage} onPress={shareDetailedSummaryImage} />
              <SecondaryButton label="Cerrar" onPress={() => setSharePreviewVisible(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

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


function AppBanner() {
  try {
    const Constants = require('expo-constants').default;
    const isExpoGo =
      Constants?.executionEnvironment === 'storeClient' ||
      Constants?.appOwnership === 'expo';

    if (isExpoGo) return null;

    const ads = require('react-native-google-mobile-ads');
    const unitId = __DEV__
      ? ads.TestIds.ADAPTIVE_BANNER
      : Platform.select({
          ios: 'ca-app-pub-5707119033456291/4377514617',
          android: 'ca-app-pub-5707119033456291/8373348372',
          default: ads.TestIds.ADAPTIVE_BANNER,
        });

    return (
      <View style={styles.bannerContainer}>
        <ads.BannerAd
          unitId={unitId}
          size={ads.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: false }}
          onAdFailedToLoad={(error: unknown) => {
            if (__DEV__) {
              console.log('[Cuánto Pago] Banner AdMob no disponible:', error);
            }
          }}
        />
      </View>
    );
  } catch (error) {
    if (__DEV__) {
      console.log('[Cuánto Pago] Banner AdMob desactivado en este entorno.');
    }
    return null;
  }
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
  bannerContainer: {
    minHeight: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBFAFF',
  },
  safe: { flex: 1, backgroundColor: '#FBFAFF' },
  flex: { flex: 1 },
  homeScreen: {
    flex: 1,
    backgroundColor: '#FBFAFF',
  },
  homeContainer: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 36,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 52,
  },
  homeBrandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  homeLogoImage: {
    width: 58,
    height: 58,
    borderRadius: 18,
  },
  homeLogoMark: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#6C45E8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C45E8',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  homeBrand: {
    color: '#12183F',
    fontSize: 26,
    fontWeight: '900',
  },
  homeProfileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1ECFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeProfileIcon: {
    color: '#6C45E8',
    fontSize: 27,
    fontWeight: '700',
  },
  homeHero: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 36,
  },
  homeHeroTitle: {
    color: '#12183F',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
    textAlign: 'center',
  },
  homeHeroAccent: {
    color: '#6C45E8',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
    textAlign: 'center',
  },
  homeHeroText: {
    marginTop: 18,
    color: '#73778B',
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    maxWidth: 510,
  },
  homeScanCard: {
    minHeight: 190,
    borderRadius: 28,
    backgroundColor: '#6C45E8',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    shadowColor: '#6C45E8',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
    marginBottom: 24,
  },
  homePressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  homeReceiptVisual: {
    width: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeScanCorners: {
    width: 82,
    height: 100,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeReceiptIcon: {
    width: 58,
    height: 58,
    resizeMode: 'contain',
  },
  homeScanCopy: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 14,
    paddingRight: 8,
  },
  homeScanTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '900',
  },
  homeScanSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    marginTop: 7,
  },
  homeArrowButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeArrow: {
    color: '#6C45E8',
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '500',
  },
  homeInfoCard: {
    minHeight: 112,
    borderRadius: 24,
    backgroundColor: '#F4F0FF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 16,
    marginBottom: 18,
  },
  homeShield: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#6C45E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeShieldIcon: {
    color: '#6C45E8',
    fontSize: 23,
    fontWeight: '900',
  },
  homeInfoTitle: {
    color: '#12183F',
    fontSize: 18,
    fontWeight: '900',
  },
  homeInfoText: {
    color: '#73778B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  homeInfoArrow: {
    color: '#6C45E8',
    fontSize: 34,
    fontWeight: '400',
  },
  homeBottomNav: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 8,
    minHeight: 88,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingBottom: 6,
    shadowColor: '#1A1740',
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  homeNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  homeNavIcon: {
    color: '#777B91',
    fontSize: 25,
    fontWeight: '700',
  },
  homeNavText: {
    color: '#777B91',
    fontSize: 12,
    fontWeight: '700',
  },
  homeNavActive: {
    color: '#6C45E8',
  },
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
  logoImage: {
    width: 42,
    height: 42,
    borderRadius: 13,
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
  stepReceiptIcon: {
    width: 24,
    height: 24,
    resizeMode: 'contain',
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
    width: 58,
    height: 58,
    resizeMode: 'contain',
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
  detectedTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#F5F0FF',
    borderWidth: 1,
    borderColor: '#DDD2FF',
  },
  detectedTipTitle: {
    color: '#28204E',
    fontWeight: '900',
    fontSize: 13,
  },
  detectedTipHint: {
    color: '#777B8E',
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  detectedTipCheck: {
    color: '#6C45E8',
    fontWeight: '900',
    fontSize: 22,
  },
  tipModeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tipModeOption: {
    flex: 1,
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DED7EB',
    backgroundColor: '#FFFFFF',
    padding: 12,
    justifyContent: 'center',
  },
  tipModeOptionSelected: {
    backgroundColor: '#6C45E8',
    borderColor: '#6C45E8',
  },
  tipModeTitle: {
    color: '#171D46',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  tipModeSubtitle: {
    color: '#777B8E',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  tipModeTextSelected: {
    color: '#FFFFFF',
  },
  tipSummary: {
    color: '#6C45E8',
    fontWeight: '900',
    fontSize: 12,
    textAlign: 'center',
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
  summaryListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  summaryListTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  summaryToggleAll: { color: '#D9CBFF', fontSize: 13, fontWeight: '900' },
  summaryPersonCard: { backgroundColor: '#1C2353', borderRadius: 16, overflow: 'hidden' },
  summaryChevron: { color: '#D9CBFF', fontSize: 18, fontWeight: '900', marginLeft: 2 },
  summaryExpanded: { borderTopWidth: 1, borderTopColor: '#30386B', paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8, gap: 7 },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  summaryLineLabel: { flex: 1, color: '#D6D4E4', fontSize: 12, lineHeight: 17 },
  summaryLineAmount: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  summaryEmpty: { color: '#AAA7BF', fontSize: 12 },
  summaryLineTotal: { borderTopWidth: 1, borderTopColor: '#3A4277', paddingTop: 8, marginTop: 2 },
  summaryLineTotalText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  sharePreviewBackdrop: { flex: 1, backgroundColor: 'rgba(18,24,63,0.72)' },
  sharePreviewScroll: { padding: 18, paddingTop: 54, paddingBottom: 38, gap: 14 },
  shareImageCard: { backgroundColor: '#12183F', borderRadius: 24, padding: 18, gap: 14 },
  shareImageBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareImageLogo: { width: 42, height: 42, borderRadius: 10 },
  shareImageBrand: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  shareImageSubtitle: { color: '#C6C3D9', fontSize: 12, marginTop: 1 },
  shareImageTotalBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, alignItems: 'center' },
  shareImageTotalLabel: { color: '#73778B', fontSize: 12, fontWeight: '800' },
  shareImageTotalAmount: { color: '#12183F', fontSize: 28, fontWeight: '900', marginTop: 3 },
  shareImagePayer: { color: '#6C45E8', fontSize: 12, fontWeight: '900', marginTop: 5 },
  shareImagePersonCard: { backgroundColor: '#1C2353', borderRadius: 15, padding: 13, gap: 6 },
  shareImagePersonHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 3 },
  shareImagePersonName: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  shareImageInvited: { color: '#E9C86A', fontSize: 10, fontWeight: '800', marginTop: 2 },
  shareImagePersonTotal: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  shareImageLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  shareImageLineLabel: { flex: 1, color: '#D6D4E4', fontSize: 11, lineHeight: 15 },
  shareImageLineAmount: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  shareImageRecover: { backgroundColor: '#EEE8FF', borderRadius: 16, padding: 13, alignItems: 'center' },
  shareImageRecoverLabel: { color: '#5E5775', fontSize: 11, fontWeight: '800' },
  shareImageRecoverAmount: { color: '#6C45E8', fontSize: 24, fontWeight: '900', marginTop: 2 },
  shareImageFooter: { color: '#9F9BB8', fontSize: 10, textAlign: 'center', fontWeight: '700' },
  sharePreviewActions: { gap: 10 },
  zeroPriceNotice: { backgroundColor: '#F5F1FF', borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#DED4FF' },
  zeroPriceNoticeTitle: { color: '#33246B', fontSize: 13, fontWeight: '900' },
  zeroPriceNoticeText: { color: '#655F76', fontSize: 12, lineHeight: 17, marginTop: 3 },
  actionSectionHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#E3E0EC' },
  actionSectionTitle: { color: '#12183F', fontSize: 15, fontWeight: '900' },
  actionSectionHint: { color: '#77788A', fontSize: 11, marginTop: 2 },
  actionSectionChevron: { color: '#6C45E8', fontSize: 20, fontWeight: '900', marginLeft: 10 },
  actionSectionBody: { gap: 8 },
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
