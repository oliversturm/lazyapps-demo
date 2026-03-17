import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';
import { nanoid } from 'nanoid';

export const GET = ({ params }) => {
  const { ep } = params;
  const correlationId = `ADM-SSE-${nanoid()}`;
  const log = getLogger('Svelte/ADM/SSE', correlationId);

  let cleanup = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (eventType, data) => {
        controller.enqueue(
          encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Send keepalive comment
      controller.enqueue(encoder.encode(':keepalive\n\n'));

      Promise.resolve(
        getPublishedMqEmitter(correlationId, process.env.MQ_QUERIES_PORT),
      )
        .then((mq) => {
          const handler = ({ payload }, cb) => {
            // Filter by endpointName if it's present in the payload
            if (payload.endpointName && payload.endpointName !== ep) {
              cb();
              return;
            }
            try {
              send('status-change', payload);
            } catch {
              // Stream closed, ignore
            }
            cb();
          };

          mq.on('adminStatusUpdate', handler);
          log.debug(`SSE stream started for endpoint ${ep}`);

          cleanup = () => {
            mq.removeListener('adminStatusUpdate', handler);
            log.debug(`SSE stream closed for endpoint ${ep}`);
          };
        })
        .catch((err) => {
          log.error(`Failed to connect to mqemitter: ${err}`);
          controller.close();
        });
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
