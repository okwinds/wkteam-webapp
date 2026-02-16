export type CatalogParam = {
  name: string
  required: boolean
  type: string
  desc: string
}

export type CatalogEndpoint = {
  operationId: string
  title: string
  module: string
  method: string
  path: string
  doc: string
  requiresAuth: boolean
  params: CatalogParam[]
}

export type Catalog = {
  generatedAt: string
  endpoints: CatalogEndpoint[]
}

export type SdkConfig = {
  baseUrl: string
  authorization: string
}

