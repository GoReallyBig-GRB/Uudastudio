/**
 * Explicitly gate the development-only sign-in bypass.
 * Non-production environments are not automatically trusted (e.g. preview/staging deployments).
 */
export function isDevAuthBypassEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  configuredFlag: string | undefined = process.env.DEV_AUTH_BYPASS
): boolean {
  return configuredFlag === 'true' && nodeEnv !== 'production';
}
