import { json } from '@sveltejs/kit';
import { adminStatusQuery } from '$lib/adminStatusQuery.js';
import { nanoid } from 'nanoid';

export const GET = ({ params }) => {
  const { ep, rm } = params;
  return adminStatusQuery(`ADM-${nanoid()}`, ep, rm).then((result) =>
    json(result),
  );
};
