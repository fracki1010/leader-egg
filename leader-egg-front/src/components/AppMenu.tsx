import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { IconChevronRight, IconSettings } from './ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';

export interface AppMenuItem {
  to: string;
  label: string;
  icon: ReactNode;
}

interface AppMenuProps {
  open: boolean;
  onClose: () => void;
  items: AppMenuItem[];
  userName?: string;
  userRole?: string;
  tenantName?: string;
}

/**
 * Facebook-style app menu: a full-height left drawer with the user header,
 * colorful shortcut rows and a small account footer.
 *
 * It is the mobile counterpart of the desktop sidebar — same destinations,
 * presented as a drawer you open from the hamburger (app bar / bottom nav).
 */
export function AppMenu({
  open,
  onClose,
  items,
  userName,
  userRole,
  tenantName,
}: AppMenuProps) {
  const location = useLocation();

  // Facebook tints every shortcut with its own accent. Cycle through the M3
  // container roles so each row reads as a distinct "app" tile.
  const tints = [
    { bg: 'primaryContainer', fg: 'onPrimaryContainer' },
    { bg: 'secondaryContainer', fg: 'onSecondaryContainer' },
    { bg: 'tertiaryContainer', fg: 'onTertiaryContainer' },
    { bg: 'infoContainer', fg: 'onInfoContainer' },
    { bg: 'successContainer', fg: 'onSuccessContainer' },
    { bg: 'errorContainer', fg: 'onErrorContainer' },
  ] as const;

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '86vw', sm: 360 },
            maxWidth: 380,
            height: '100dvh',
            maxHeight: '100dvh',
            bgcolor: 'surface',
            borderTopRightRadius: '20px',
            borderBottomRightRadius: '20px',
            display: 'flex',
            flexDirection: 'column',
            // The shortcuts list owns the scroll; the account footer stays pinned.
            overflow: 'hidden',
          },
        },
      }}
    >
      {/* User header */}
      <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>
            El Huevo Líder
          </Typography>
          {tenantName && tenantName !== 'El Huevo Líder' && (
            <Typography component="div" variant="caption" color="onSurfaceVariant" noWrap>
              · {tenantName}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 44,
              height: 44,
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              fontWeight: 700,
            }}
          >
            {userName?.charAt(0).toUpperCase() ?? '?'}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="div" variant="titleSmall" noWrap sx={{ fontWeight: 700 }}>
              {userName ?? 'Usuario'}
            </Typography>
            <Typography
              component="div"
              variant="caption"
              color="onSurfaceVariant"
              sx={{ textTransform: 'capitalize', mt: 0.25 }}
            >
              {userRole ?? ''}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Divider />

      {/* Shortcuts */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            px: 1,
            mb: 0.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'onSurfaceVariant',
          }}
        >
          Tus accesos
        </Typography>

        {items.length === 0 && (
          <Typography
            component="p"
            variant="body2"
            color="onSurfaceVariant"
            sx={{ px: 1, py: 1.5, m: 0, lineHeight: 1.5 }}
          >
            No tenés accesos adicionales. Usá la barra inferior para navegar.
          </Typography>
        )}

        {items.map((item, index) => {
          const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
          const tint = tints[index % tints.length]!;
          return (
            <Box
              key={item.to}
              component={NavLink}
              to={item.to}
              onClick={onClose}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1,
                py: 0.75,
                my: 0.25,
                borderRadius: m3Shape.medium,
                textDecoration: 'none',
                color: 'onSurface',
                bgcolor: active
                  ? (theme: Theme) => alpha(theme.palette.primary.main, 0.12)
                  : 'transparent',
                '&:hover': {
                  bgcolor: active
                    ? (theme: Theme) => alpha(theme.palette.primary.main, 0.16)
                    : 'action.hover',
                },
                '&:focus-visible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  bgcolor: tint.bg,
                  color: tint.fg,
                  '& svg': { width: 20, height: 20 },
                }}
              >
                {item.icon}
              </Box>
              <Typography
                component="div"
                variant="body2"
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: active ? 700 : 600,
                  color: active ? 'primary.main' : 'onSurface',
                }}
              >
                {item.label}
              </Typography>
              <Box aria-hidden="true" sx={{ display: 'flex', color: 'onSurfaceVariant', flexShrink: 0 }}>
                <IconChevronRight size={16} />
              </Box>
            </Box>
          );
        })}
      </Box>

      <Divider />

      {/* Account footer — the only account action left here is the shortcut to
          Settings; appearance and logout live on that screen. */}
      <Box sx={{ px: 1.5, py: 1.5 }}>
        <Box
          component={NavLink}
          to="/settings"
          onClick={onClose}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1,
            py: 0.75,
            borderRadius: m3Shape.medium,
            textDecoration: 'none',
            color: 'onSurface',
            '&:hover': { bgcolor: 'action.hover' },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 2,
            },
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
            }}
          >
            <IconSettings size={20} />
          </Box>
          <Typography component="div" variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
            Ajustes
          </Typography>
          <Box aria-hidden="true" sx={{ display: 'flex', color: 'onSurfaceVariant', flexShrink: 0 }}>
            <IconChevronRight size={16} />
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
