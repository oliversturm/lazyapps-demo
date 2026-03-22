import { nanoid } from 'nanoid';
import { getToken } from './auth';

const commandEndpoint = import.meta.env.VITE_COMMAND_URL || 'http://127.0.0.1:3001/api/command';

// Same code as React
const _postCommand = (endpoint, content) => {
	const correlationId = `SVLT-${nanoid()}`;
	content.correlationId = correlationId;
	const headers = { 'Content-Type': 'application/json' };
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return fetch(endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify(content)
	})
		.then((res) => {
			if (!res.ok) {
				throw new Error(`Fetch error: ${res.status}/${res.statusText}`);
			}
			return res;
		})
		.catch((err) => {
			console.error(
				`Can't post command to ${endpoint} with content ${JSON.stringify(content)}: ${err}`
			);
		});
};

export const postCommand = (content) => _postCommand(commandEndpoint, content);

// The forget cascade (FORGET_RELATED_SUBJECT to orders) is handled by the
// orders readmodel projection, not the frontend. The frontend only sends
// FORGET_SUBJECT for the customer aggregate; the readmodel takes care of
// finding and forgetting related orders via service-to-service auth.
export const forgetSubject = (subjectId) =>
	postCommand({
		aggregateName: 'customer',
		aggregateId: subjectId,
		command: 'FORGET_SUBJECT',
		payload: { subjectId }
	});
