import { createSlice } from '@reduxjs/toolkit';

import dataLoadedReducer from './dataLoaded.reducer';

const slice = createSlice({
  name: 'orderConfirmationRequestsView',
  initialState: {},
  reducers: {
    dataLoaded: dataLoadedReducer,
    dataChanged: dataLoadedReducer,
  },
});

export const { dataLoaded, dataChanged } = slice.actions;
export default slice.reducer;
