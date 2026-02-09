import { createSlice } from '@reduxjs/toolkit';

import dataLoadedReducer from './dataLoaded.reducer';

const slice = createSlice({
  name: 'ordersView',
  initialState: {},
  reducers: {
    dataLoaded: dataLoadedReducer,
  },
});

export const { dataLoaded } = slice.actions;
export default slice.reducer;
