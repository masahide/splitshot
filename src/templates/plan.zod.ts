import {
    ProfileSchema,
    TaskSpecSchema,
    GeneratedFileSchema,
    PlanSchema,
} from "../schemas/plan.js";

// テンプレート側でも同じ Zod 定義を利用できるよう、別名で再エクスポート
export const ProfileZ = ProfileSchema;
export const TaskZ = TaskSpecSchema;
export const GeneratedFileZ = GeneratedFileSchema;
export const PlanZ = PlanSchema;
