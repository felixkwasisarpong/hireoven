export interface BlogCategory {
  id: number
  slug: string
  name: string
  description: string
  day_of_week: number
}

export interface BlogPost {
  id: string
  category_id: number
  slug: string
  title: string
  excerpt: string
  body: string
  seo_description: string | null
  hero_image_url: string | null
  hero_image_key: string | null
  hero_image_alt: string | null
  image_prompt: string | null
  reading_time: number | null
  status: "draft" | "published"
  published_at: string | null
  created_at: string
  category?: BlogCategory
}
