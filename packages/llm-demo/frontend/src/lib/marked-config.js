import { Marked } from 'marked';

export const createMarked = () =>
  new Marked({
    renderer: {
      html({ raw }) {
        return raw.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    },
  });
