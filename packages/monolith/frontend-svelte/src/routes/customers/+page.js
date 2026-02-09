import { queryClient } from '$lib/queryClient.js';
import { nanoid } from 'nanoid';

export const ssr = false;

export function load() {
	const correlationId = `SVLT-${nanoid()}`;
	return {
		correlationId,
		queryFn: () => queryClient('customersOverview', 'all')
	};
}
