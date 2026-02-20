export default {
  initial: () => ({}),

  commands: {
    FORGET_SUBJECT: (aggregate, payload) => ({
      type: 'SUBJECT_FORGOTTEN',
      payload,
    }),
  },

  projections: {
    SUBJECT_FORGOTTEN: (aggregate, { payload }) => ({
      ...aggregate,
      forgotten: true,
      forgottenAt: payload.timestamp,
    }),
  },
};
