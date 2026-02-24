/**
 * POST /admin/algolia/sync
 *
 * Emits the `algolia.sync` event, which triggers the algolia-sync subscriber
 * to do a full paginated reindex of all products.
 *
 * Protected by admin authentication (applied automatically by Medusa to all
 * routes under /admin/**).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const eventModuleService = req.scope.resolve(Modules.EVENT_BUS)

  await eventModuleService.emit({
    name: "algolia.sync",
    data: {},
  })

  res.json({ message: "Algolia full reindex started in the background." })
}
