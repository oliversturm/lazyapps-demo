import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';
import { nanoid } from 'nanoid';

// Bridges CP status changes from the in-process 'commands' mqemitter
// (adminCpStatusUpdate, published by @lazyapps/mqemitter/commandReceiverMqEmitter)
// to admin SSE (issue #23). The CP analog of the RM events/[ep] bridge; mirrors
// the express command receiver's /admin/commandprocessor/events endpoint so
// admin-api's sse-client needs no changes.
export const GET = () => {
	const correlationId = `ADM-CP-SSE-${nanoid()}`;
	const log = getLogger('Svelte/ADM/CpSSE', correlationId);

	let cleanup = null;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const send = (eventType, data) => {
				controller.enqueue(
					encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			};

			// Send keepalive comment
			controller.enqueue(encoder.encode(':keepalive\n\n'));

			Promise.resolve(getPublishedMqEmitter(correlationId, process.env.MQ_COMMANDS_PORT))
				.then((mq) => {
					const handler = ({ payload }, cb) => {
						try {
							send('status-change', payload);
						} catch {
							// Stream closed, ignore
						}
						cb();
					};

					mq.on('adminCpStatusUpdate', handler);
					log.debug('CP SSE stream started');

					cleanup = () => {
						mq.removeListener('adminCpStatusUpdate', handler);
						log.debug('CP SSE stream closed');
					};
				})
				.catch((err) => {
					log.error(`Failed to connect to mqemitter: ${err}`);
					controller.close();
				});
		},
		cancel() {
			if (cleanup) cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
