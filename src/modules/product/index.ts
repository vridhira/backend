import { defineModule } from "@medusajs/framework/utils";

export const PRODUCT_MODULE_KEY = "product";

export default defineModule(PRODUCT_MODULE_KEY, {
  key: PRODUCT_MODULE_KEY,
  label: "Product",
});
