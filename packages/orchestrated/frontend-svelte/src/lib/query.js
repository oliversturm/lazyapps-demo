import { getToken } from './auth';

export const query =
	(correlationId, fetch) =>
	(endpoint, readModelName, resolverName, params = {}) => {
		const url = new URL(`/query/${readModelName}/${resolverName}`, endpoint);
		const headers = { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId };
		const token = getToken();
		if (token) headers['Authorization'] = `Bearer ${token}`;

		return fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(params)
		})
			.then((res) => {
				if (!res.ok) {
					throw new Error(`[${correlationId}] Fetch error: ${res.status}/${res.statusText}`);
				}
				return res;
			})
			.then((res) => res.json())
			.catch((err) => {
				console.error(
					`[${correlationId}] Can't query ${url} with params ${JSON.stringify(params)}: ${err}`
				);
			});
	};
