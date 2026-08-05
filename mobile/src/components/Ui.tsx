import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function PrimaryButton({
label,
onPress,
disabled = false,
}: {
label: string;
onPress: () => void;
disabled?: boolean;
}) {
return (
<Pressable
style={[
styles.primary,
disabled && styles.buttonDisabled,
]}
onPress={onPress}
disabled={disabled}
>
<Text
style={[
styles.primaryText,
disabled && styles.buttonTextDisabled,
]}
>
{label}
</Text>
</Pressable>
);
}

export function SecondaryButton({
label,
onPress,
disabled = false,
}: {
label: string;
onPress: () => void;
disabled?: boolean;
}) {
return (
<Pressable
style={[
styles.secondary,
disabled && styles.buttonDisabled,
]}
onPress={onPress}
disabled={disabled}
>
<Text
style={[
styles.secondaryText,
disabled && styles.buttonTextDisabled,
]}
>
{label}
</Text>
</Pressable>
);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E8E8EE',
  },
  primary: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#19191F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondary: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D7D7DE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: { color: '#25252B', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
  buttonDisabled: {
opacity: 0.5,
},

buttonTextDisabled: {
opacity: 0.8,
},
});
