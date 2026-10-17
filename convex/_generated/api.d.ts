/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as assistant from "../assistant.js";
import type * as authz from "../authz.js";
import type * as care from "../care.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as eventDetection from "../eventDetection.js";
import type * as families from "../families.js";
import type * as familySummaries from "../familySummaries.js";
import type * as http from "../http.js";
import type * as lib_careAlerts from "../lib/careAlerts.js";
import type * as lib_careEmail from "../lib/careEmail.js";
import type * as lib_familySummaryLogic from "../lib/familySummaryLogic.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_liveConversations from "../lib/liveConversations.js";
import type * as lib_pyannote from "../lib/pyannote.js";
import type * as lib_sarvam from "../lib/sarvam.js";
import type * as lib_speakerMatching from "../lib/speakerMatching.js";
import type * as patients from "../patients.js";
import type * as people from "../people.js";
import type * as privacy from "../privacy.js";
import type * as push from "../push.js";
import type * as recordings from "../recordings.js";
import type * as reset from "../reset.js";
import type * as speakerMatching from "../speakerMatching.js";
import type * as transcriptions from "../transcriptions.js";
import type * as voices from "../voices.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  assistant: typeof assistant;
  authz: typeof authz;
  care: typeof care;
  conversations: typeof conversations;
  crons: typeof crons;
  eventDetection: typeof eventDetection;
  families: typeof families;
  familySummaries: typeof familySummaries;
  http: typeof http;
  "lib/careAlerts": typeof lib_careAlerts;
  "lib/careEmail": typeof lib_careEmail;
  "lib/familySummaryLogic": typeof lib_familySummaryLogic;
  "lib/functions": typeof lib_functions;
  "lib/liveConversations": typeof lib_liveConversations;
  "lib/pyannote": typeof lib_pyannote;
  "lib/sarvam": typeof lib_sarvam;
  "lib/speakerMatching": typeof lib_speakerMatching;
  patients: typeof patients;
  people: typeof people;
  privacy: typeof privacy;
  push: typeof push;
  recordings: typeof recordings;
  reset: typeof reset;
  speakerMatching: typeof speakerMatching;
  transcriptions: typeof transcriptions;
  voices: typeof voices;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
