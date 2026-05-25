import { EntitySchema } from "@mikro-orm/core";

export class MessagingProbe {
  id!: string;
  label!: string;
  sideEffectCount: number = 0;
}

export const MessagingProbeSchema = new EntitySchema<MessagingProbe>({
  class: MessagingProbe,
  tableName: "messaging_probe",
  properties: {
    id: { type: "string", primary: true },
    label: { type: "string" },
    sideEffectCount: {
      type: "int",
      fieldName: "side_effect_count",
      default: 0,
    },
  },
});
