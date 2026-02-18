import { z } from 'zod'

/**
 * 服务端配置（环境变量）
 *
 * - 功能：解析并校验运行时所需配置
 * - 参数：来自 process.env（仅在 server 入口调用）
 * - 返回：强类型 config
 * - 错误：校验失败抛出异常（启动即失败，避免“半配置半运行”）
 */
export function loadServerConfig(env: NodeJS.ProcessEnv) {
  const schema = z.object({
    HOST: z.string().optional().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).optional().default(8787),
    DATA_DIR: z.string().optional().default('./data'),

    BFF_API_TOKEN: z.string().min(10),
    WEBHOOK_SECRET: z.string().min(10),
    // 可选：单机单用户登录口令（用于 session cookie 登录）
    // - 若未设置，则默认复用 BFF_API_TOKEN 作为登录口令（避免新增必填配置）
    LOCAL_LOGIN_PASSWORD: z.string().optional().default(''),
    // 可选：webhook 额外安全增强
    WEBHOOK_IP_ALLOWLIST: z.string().optional().default(''),
    WEBHOOK_RATE_LIMIT_PER_MIN: z.coerce.number().int().optional().default(0),

    CORS_ALLOW_ORIGINS: z.string().optional().default(''),

    MAX_BODY_BYTES: z.coerce.number().int().min(1024).optional().default(1024 * 1024),
    MAX_DATAURL_BYTES: z.coerce.number().int().min(1024).optional().default(500 * 1024),
    MAX_WEBHOOK_RAW_BYTES: z.coerce.number().int().min(1024).optional().default(32 * 1024),

    OPENAI_BASE_URL: z.string().url(),
    OPENAI_API_KEY: z.string().min(10),
    OPENAI_MODEL: z.string().min(1).optional().default('gpt-4o-mini'),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).optional().default(20000),
    OPENAI_PATH_CHAT_COMPLETIONS: z.string().optional().default('/v1/chat/completions'),

    UPSTREAM_BASE_URL: z.string().optional().default(''),
    UPSTREAM_AUTHORIZATION: z.string().optional().default(''),
    UPSTREAM_AUTH_HEADER_NAME: z.string().optional().default('Authorization'),
    UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).optional().default(15000),
    WKTEAM_CATALOG_PATH: z.string().optional().default('./public/wkteam-api-catalog.json')
  })

  return schema.parse(env)
}

export type ServerConfig = ReturnType<typeof loadServerConfig>
