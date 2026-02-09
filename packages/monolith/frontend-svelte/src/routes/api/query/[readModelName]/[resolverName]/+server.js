import { json } from '@sveltejs/kit';
import { query } from '$lib/query.js';
import { nanoid } from 'nanoid';

export const POST = ({ params, request }) =>
	request.json().then((body) =>
		query(`SVLT-${nanoid()}`, params.readModelName, params.resolverName, body).then((result) =>
			json(result)
		)
	);
