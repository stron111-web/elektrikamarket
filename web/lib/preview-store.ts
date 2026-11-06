/** Превью отличает роль контейнера. На других стендах этой роли нет. */
export function isPreviewStore() {
  return process.env.STOREFRONT_DATABASE_ROLE === 'storefront_preview_ro';
}
