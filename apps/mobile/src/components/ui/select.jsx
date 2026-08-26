import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";

import { cn } from "@/lib/utils";

/**
 * Sustituto del Select de Radix. Abre una lista a pantalla completa con
 * buscador: con 50 estados, un desplegable corto no sirve en móvil.
 */
export function Select({ value, onValueChange, options, placeholder = "Seleccionar", title, className }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find(([code]) => code === value);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter(([code, label]) => code.toLowerCase().includes(term) || label.toLowerCase().includes(term));
  }, [options, search]);

  const choose = (code) => {
    onValueChange(code);
    setOpen(false);
    setSearch("");
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className={cn("h-11 flex-row items-center justify-between rounded-lg border border-input bg-card px-3", className)}
      >
        <Text className={selected ? "text-base text-foreground" : "text-base text-muted-foreground"}>
          {selected ? selected[0] + " - " + selected[1] : placeholder}
        </Text>
        <ChevronDown size={18} color="#64748b" />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-background">
          <View className="gap-3 border-b border-border bg-card p-4 pt-14">
            <Text className="text-lg font-semibold text-foreground">{title || placeholder}</Text>
            <TextInput
              className="h-11 rounded-lg border border-input bg-background px-3 text-base text-foreground"
              placeholder="Buscar..."
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={([code]) => code}
            renderItem={({ item: [code, label] }) => (
              <Pressable
                onPress={() => choose(code)}
                className="flex-row items-center justify-between border-b border-border px-4 py-4 active:bg-muted"
              >
                <Text className="text-base text-foreground">{code} - {label}</Text>
                {code === value ? <Check size={18} color="#65baaf" /> : null}
              </Pressable>
            )}
          />

          <Pressable onPress={() => setOpen(false)} className="border-t border-border bg-card p-4">
            <Text className="text-center text-base font-semibold text-foreground">Cancelar</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
