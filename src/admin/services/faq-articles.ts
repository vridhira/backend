/**
 * FAQ Articles Admin API Client
 *
 * Service for managing FAQ articles from the admin dashboard.
 * Wraps API calls for CRUD operations on FAQ articles.
 */

import { sdk } from "../lib/sdk"

export type FaqArticle = {
  id: string
  title: string
  description: string
  section: "buying" | "shipping" | "payments" | "account" | "trust"
  content: string
  is_visible: boolean
  display_order: number
  total_views: number
  created_at: string
  updated_at: string
}

export type FaqArticlesResponse = {
  articles: FaqArticle[]
  count: number
  offset: number
  limit: number
}

export type CreateFaqArticleInput = {
  title: string
  description: string
  section: "buying" | "shipping" | "payments" | "account" | "trust"
  content: string
  is_visible?: boolean
  display_order?: number
}

export type UpdateFaqArticleInput = Partial<CreateFaqArticleInput>

class FaqArticlesAdminService {
  /**
   * GET /admin/faq-articles
   * List all FAQ articles with optional filtering
   */
  async listArticles(params?: {
    section?: string
    visibility?: "all" | "visible" | "hidden"
    limit?: number
    offset?: number
  }): Promise<FaqArticlesResponse> {
    const queryParams = new URLSearchParams()

    if (params?.section && params.section !== "all") {
      queryParams.set("section", params.section)
    }
    if (params?.visibility && params.visibility !== "all") {
      queryParams.set("visibility", params.visibility)
    }
    if (params?.limit) {
      queryParams.set("limit", params.limit.toString())
    }
    if (params?.offset) {
      queryParams.set("offset", params.offset.toString())
    }

    const response = await sdk.client.fetch<FaqArticlesResponse>(
      `/admin/faq-articles?${queryParams.toString()}`
    )
    return response
  }

  /**
   * GET /admin/faq-articles/[id]
   * Fetch a single FAQ article by ID
   */
  async getArticle(id: string): Promise<{ article: FaqArticle }> {
    return await sdk.client.fetch(`/admin/faq-articles/${id}`)
  }

  /**
   * POST /admin/faq-articles
   * Create a new FAQ article
   */
  async createArticle(data: CreateFaqArticleInput): Promise<{ article: FaqArticle }> {
    return await sdk.client.fetch("/admin/faq-articles", {
      method: "POST",
      body: data,
    })
  }

  /**
   * PATCH /admin/faq-articles/[id]
   * Update an existing FAQ article
   */
  async updateArticle(
    id: string,
    data: UpdateFaqArticleInput
  ): Promise<{ article: FaqArticle }> {
    return await sdk.client.fetch(`/admin/faq-articles/${id}`, {
      method: "PATCH",
      body: data,
    })
  }

  /**
   * DELETE /admin/faq-articles/[id]
   * Delete a FAQ article
   */
  async deleteArticle(id: string): Promise<{ message: string }> {
    return await sdk.client.fetch(`/admin/faq-articles/${id}`, {
      method: "DELETE",
    })
  }

  /**
   * PATCH /admin/faq-articles/[id]
   * Toggle article visibility (hide/show)
   */
  async toggleVisibility(id: string, currentVisibility: boolean): Promise<{ article: FaqArticle }> {
    return await sdk.client.fetch(`/admin/faq-articles/${id}`, {
      method: "PATCH",
      body: { is_visible: !currentVisibility },
    })
  }

  /**
   * PATCH /admin/faq-articles/[id]
   * Update display order
   */
  async updateDisplayOrder(id: string, displayOrder: number): Promise<{ article: FaqArticle }> {
    return await sdk.client.fetch(`/admin/faq-articles/${id}`, {
      method: "PATCH",
      body: { display_order: displayOrder },
    })
  }

  /**
   * Batch update visibility for multiple articles
   */
  async batchToggleVisibility(
    ids: string[],
    isVisible: boolean
  ): Promise<{ updated: number }> {
    const results = await Promise.all(
      ids.map((id) =>
        sdk.client.fetch(`/admin/faq-articles/${id}`, {
          method: "PATCH",
          body: { is_visible: isVisible },
        })
      )
    )
    return { updated: results.length }
  }
}

// Export singleton instance
export const faqArticlesAdminService = new FaqArticlesAdminService()
