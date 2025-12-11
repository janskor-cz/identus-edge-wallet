import { Store } from "redux";
import { configureStore } from '@reduxjs/toolkit'
import { bindActionCreators } from "redux";
import { useMemo } from "react";

import rootReducer from "./index";

import * as actions from "../actions";

import { RootState, initialState } from "./app";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";


export const store = configureStore({
    reducer: rootReducer,
    devTools: false,
    preloadedState: {
        app: initialState
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            // Explicitly enable thunk (it's enabled by default, but being explicit)
            thunk: true,
            serializableCheck: {
                // Ignore these action types that contain non-serializable values
                ignoredActions: [
                    'connectDatabase/pending',
                    'connectDatabase/fulfilled',
                    'connectDatabase/rejected',
                    'app/dbPreload',
                    'app/messageSuccess',
                    'initAgent/pending',
                    'initAgent/fulfilled',
                    'initAgent/rejected',
                    'startAgent/pending',
                    'startAgent/fulfilled',
                    'startAgent/rejected',
                    'connections/refresh/pending',
                    'connections/refresh/fulfilled',
                    'connections/refresh/rejected',
                    'credentials/refresh/pending',
                    'credentials/refresh/fulfilled',
                    'credentials/refresh/rejected',
                    'persist/PERSIST',
                    'persist/REHYDRATE'
                ],
                // Ignore these field paths in all actions
                ignoredActionsPaths: [
                    'meta.arg',
                    'meta.baseQueryMeta',
                    'payload.db',
                    'payload.agent',
                    'payload.selfDID',
                    'payload.messages',
                    'payload.connections',
                    'payload.credentials',
                    'payload.defaultSeed',
                    'payload.defaultSeed.value',
                    'payload.value',
                    'payload.encryptionKey',
                    'register',
                    'rehydrate'
                ],
                // Ignore these paths in the state
                ignoredPaths: [
                    'app.db.instance',
                    'app.agent.instance',
                    'app.agent.selfDID',
                    'app.messages',
                    'app.connections',
                    'app.credentials',
                    'app.mediatorDID',
                    'app.errors',
                    'app.defaultSeed.value',
                    'app.defaultSeed',
                    'register',
                    'rehydrate'
                ]
            },
            immutableCheck: {
                ignoredPaths: [
                    'app.db.instance',
                    'app.agent.instance',
                    'app.agent.selfDID',
                    'app.messages',
                    'app.connections',
                    'app.credentials',
                    'app.defaultSeed.value',
                    'app.defaultSeed'
                ]
            }
        })
});

export type AppDispatch = typeof store.dispatch;
export const useAppSelector: TypedUseSelectorHook<{ app: RootState }> =
    useSelector;

export const useMountedApp = () => {
    const dispatch = useDispatch<AppDispatch>();
    const dispatchedActions = useMemo(
        () => bindActionCreators(actions, dispatch),
        [dispatch]
    );
    const state = useAppSelector((state) => state.app);

    return {
        ...state,
        ...dispatchedActions,
        dispatch
    };
};

export const wrapper: Store = store;
