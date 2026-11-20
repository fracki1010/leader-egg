/**
 * DEPRECATED — replaced by `promote-admin.ts`.
 *
 * The tenant `superadmin` role was retired in the multi-tenant refactor. Tenant
 * roles are now `admin | driver | puesto | viewer`; the highest tenant role is
 * `admin`. Platform admins live in the master/platform database and are managed
 * through the platform module (`/v1/platform`), not through this script.
 *
 * This stub performs NO database writes and exits with a non-zero code so that
 * automated callers fail loudly instead of silently doing the wrong thing.
 *
 * Migration:
 *   npx tsx src/scripts/promote-admin.ts --tenant <slug> --email <email>
 */
console.error('[DEPRECATED] promote-superadmin.ts está obsoleto y no realiza cambios.');
console.error('Usa: npx tsx src/scripts/promote-admin.ts --tenant <slug> --email <email>');
console.error('El rol de tenant "superadmin" fue retirado; ahora se usa "admin" dentro de cada tenant.');

process.exit(1);
