import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappApi, type WhatsappConnection, type WhatsappConnectionState } from '../../api/whatsapp.ts';
import { ApiError } from '../../api/client.ts';
import { MuiButton } from '../ui/index.ts';

const QUERY_KEY = ['whatsapp', 'connection'] as const;

const STATE_LABELS: Record<WhatsappConnectionState, string> = {
  not_created: 'Sin conectar',
  created: 'Esperando escaneo',
  connecting: 'Conectando',
  open: 'Conectado',
  close: 'Desconectado',
  unknown: 'Estado desconocido',
};

/** The API sends the QR as a data URL or as bare base64; accept both. */
const qrSource = (qr: string): string => (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`);

/**
 * Settings block that links the business WhatsApp to the assistant by QR code.
 * While the line is not open the QR is polled, since it expires and is replaced.
 */
export function WhatsappSection() {
  const queryClient = useQueryClient();

  const connection = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => whatsappApi.getConnection(),
    refetchInterval: (query) => (query.state.data?.state === 'open' ? false : 5000),
  });

  const connect = useMutation({
    mutationFn: () => whatsappApi.connect(),
    onSuccess: (data: WhatsappConnection) => queryClient.setQueryData(QUERY_KEY, data),
  });

  const data = connection.data;
  const error = connect.error ?? connection.error;
  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'No se pudo consultar WhatsApp.' : null;

  return (
    <Box component="section" sx={{ minWidth: 0 }}>
      <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface' }}>
        WhatsApp del negocio
      </Typography>
      <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mb: 1.5 }}>
        Escaneá el QR desde WhatsApp → Dispositivos vinculados para que el asistente responda en el número del negocio.
      </Typography>

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {errorMessage}
        </Alert>
      )}

      <Typography variant="body2" sx={{ mb: 1.5 }}>
        Estado: <strong>{data ? STATE_LABELS[data.state] : 'Cargando…'}</strong>
      </Typography>

      {data?.qrCode && (
        <Box
          component="img"
          src={qrSource(data.qrCode)}
          alt="Código QR de WhatsApp"
          sx={{ width: 220, maxWidth: '100%', display: 'block', mb: 1.5, borderRadius: '12px' }}
        />
      )}

      {data?.state !== 'open' && (
        <MuiButton
          variant="secondary"
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
        >
          {data?.state === 'not_created' ? 'Conectar WhatsApp' : 'Generar nuevo QR'}
        </MuiButton>
      )}
    </Box>
  );
}
