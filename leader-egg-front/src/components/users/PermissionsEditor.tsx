import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import {
  MODULE_LABELS,
  MODULE_LEVELS,
  MODULE_DISPLAY_ORDER,
  PRESETS,
  PRESET_KEYS,
  PRESET_LABELS,
  normalizePermissions,
  samePermissions,
  type PermissionModule,
} from '../../lib/permissions.ts';

interface PermissionsEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/** Current level for a module, derived from the flat permission list. */
function levelFor(value: string[], module: PermissionModule): '' | 'view' | 'manage' {
  if (value.includes(`${module}.manage`)) return 'manage';
  if (value.includes(`${module}.view`)) return 'view';
  return '';
}

const LEVEL_LABELS: Record<'' | 'view' | 'manage', string> = {
  '': 'Sin acceso',
  view: 'Ver',
  manage: 'Administrar',
};

/**
 * PermissionsEditor — controlled per-module permission picker.
 *
 * Presets replace the whole list; each module row toggles between no access,
 * view and manage. Reports only exposes view, while users/config only expose
 * manage (mirroring the backend catalog). The component is pure: every change
 * is normalized before being emitted.
 */
export function PermissionsEditor({ value, onChange, disabled = false }: PermissionsEditorProps) {
  const setLevel = (module: PermissionModule, next: '' | 'view' | 'manage') => {
    const withoutModule = value.filter((permission) => !permission.startsWith(`${module}.`));
    const nextValue = next === '' ? withoutModule : [...withoutModule, `${module}.${next}`];
    onChange(normalizePermissions(nextValue));
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 2,
        borderRadius: '16px',
        border: 1,
        borderColor: 'outlineVariant',
        bgcolor: 'surfaceContainerLow',
      }}
    >
      {/* Presets */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="labelMedium" color="onSurfaceVariant">
          Accesos rápidos
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {PRESET_KEYS.map((key) => {
            const active = samePermissions(value, PRESETS[key]);
            return (
              <Chip
                key={key}
                label={PRESET_LABELS[key]}
                disabled={disabled}
                onClick={() => onChange(normalizePermissions(PRESETS[key]))}
                sx={{
                  minHeight: 44,
                  fontWeight: active ? 700 : 600,
                  ...(active
                    ? { bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }
                    : { bgcolor: 'surfaceContainer', color: 'onSurfaceVariant' }),
                }}
              />
            );
          })}
        </Box>
      </Box>

      <Typography variant="caption" color="onSurfaceVariant">
        Administrar incluye ver.
      </Typography>

      {/* One row per module */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {MODULE_DISPLAY_ORDER.map((module) => {
          const levels = MODULE_LEVELS[module];
          const current = levelFor(value, module);
          return (
            <Box
              key={module}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
                px: 1.5,
                py: 1,
                borderRadius: '12px',
                bgcolor: 'surfaceContainerLowest',
                border: 1,
                borderColor: 'outlineVariant',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface', minWidth: 88 }}>
                {MODULE_LABELS[module]}
              </Typography>

              <ToggleButtonGroup
                exclusive
                size="small"
                disabled={disabled}
                value={current}
                aria-label={`Acceso a ${MODULE_LABELS[module]}`}
                onChange={(_event, next: string | null) => {
                  setLevel(module, (next ?? '') as '' | 'view' | 'manage');
                }}
                sx={{
                  flexWrap: 'wrap',
                  gap: 0.75,
                  '& .MuiToggleButtonGroup-grouped': {
                    border: 1,
                    borderColor: 'outlineVariant',
                    borderRadius: '10px !important',
                    ml: 0,
                    minHeight: 44,
                    px: 1.5,
                    textTransform: 'none',
                    fontWeight: 600,
                    color: 'onSurfaceVariant',
                    bgcolor: 'surfaceContainerLowest',
                    '&:hover': { bgcolor: 'surfaceContainerHigh' },
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main',
                      '&:hover': { bgcolor: 'primary.dark' },
                    },
                  },
                }}
              >
                <ToggleButton value="" aria-label={`${MODULE_LABELS[module]}: sin acceso`}>
                  {LEVEL_LABELS['']}
                </ToggleButton>
                {levels.includes('view') && (
                  <ToggleButton value="view" aria-label={`${MODULE_LABELS[module]}: ver`}>
                    {LEVEL_LABELS.view}
                  </ToggleButton>
                )}
                {levels.includes('manage') && (
                  <ToggleButton value="manage" aria-label={`${MODULE_LABELS[module]}: administrar`}>
                    {LEVEL_LABELS.manage}
                  </ToggleButton>
                )}
              </ToggleButtonGroup>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
