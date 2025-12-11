import { combineReducers } from "redux";

import app from "./app";
import enterpriseAgent from "./enterpriseAgent";

const rootReducer = combineReducers({
    app,
    enterpriseAgent,
});

export default rootReducer;
