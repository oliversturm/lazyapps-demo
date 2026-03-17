import { json } from '@sveltejs/kit';
import { adminQuery } from '$lib/adminQuery.js';
import { nanoid } from 'nanoid';

export const GET = () =>
  adminQuery(`ADM-${nanoid()}`).then((result) => json(result));
