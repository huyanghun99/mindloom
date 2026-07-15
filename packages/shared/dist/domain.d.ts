import type { TopicStatus, SpaceAiPrivacyPolicy } from './types';
/** Returns true when a topic may move from `from` to `to`. */
export declare function isValidTopicTransition(from: TopicStatus, to: TopicStatus): boolean;
/**
 * When a source Page is updated, an accepted or user_edited topic becomes stale.
 * Suggested / archived topics are unaffected (spec §16.2: "来源 Page 更新 → stale").
 */
export declare function markTopicStaleOnSourceUpdate(status: TopicStatus): TopicStatus;
/** A topic is user-touched once it has been edited by the user (spec §16.3 不覆盖原则). */
export declare function isTopicUserTouched(status: TopicStatus): boolean;
/** Suggestion action types and their inherent risk level. */
export type SuggestionActionType = 'create_topic' | 'update_topic' | 'overwrite_user_edited' | 'delete_topic' | 'add_edge' | 'update_summary';
/**
 * Classify the risk of an AI suggestion action (spec §24.1 suggestion risk 分类).
 * - high: destructive or overwrites user-authored content
 * - medium: mutates existing accepted content
 * - low: additive / new content
 */
export declare function classifySuggestionRisk(action: SuggestionActionType): 'low' | 'medium' | 'high';
/** Whether the privacy policy forces local-only AI processing (no cloud calls). */
export declare function isLocalOnlyPolicy(policy: SpaceAiPrivacyPolicy): boolean;
/** Whether the privacy policy disables AI processing entirely. */
export declare function isAiDisabledPolicy(policy: SpaceAiPrivacyPolicy): boolean;
/** Whether cloud LLM providers may be used for this space. */
export declare function allowsCloudProcessing(policy: SpaceAiPrivacyPolicy): boolean;
