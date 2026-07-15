/**
 * Topic lifecycle state machine (spec §16.2).
 * Defines which transitions are user/system-initiated and valid.
 */
const TOPIC_TRANSITIONS = {
    suggested: ['accepted', 'archived'],
    accepted: ['user_edited', 'stale', 'archived'],
    user_edited: ['stale', 'archived'],
    stale: ['accepted', 'user_edited', 'archived'],
    archived: ['accepted']
};
/** Returns true when a topic may move from `from` to `to`. */
export function isValidTopicTransition(from, to) {
    return TOPIC_TRANSITIONS[from]?.includes(to) ?? false;
}
/**
 * When a source Page is updated, an accepted or user_edited topic becomes stale.
 * Suggested / archived topics are unaffected (spec §16.2: "来源 Page 更新 → stale").
 */
export function markTopicStaleOnSourceUpdate(status) {
    return status === 'accepted' || status === 'user_edited' ? 'stale' : status;
}
/** A topic is user-touched once it has been edited by the user (spec §16.3 不覆盖原则). */
export function isTopicUserTouched(status) {
    return status === 'user_edited';
}
/**
 * Classify the risk of an AI suggestion action (spec §24.1 suggestion risk 分类).
 * - high: destructive or overwrites user-authored content
 * - medium: mutates existing accepted content
 * - low: additive / new content
 */
export function classifySuggestionRisk(action) {
    switch (action) {
        case 'overwrite_user_edited':
        case 'delete_topic':
            return 'high';
        case 'update_topic':
        case 'update_summary':
            return 'medium';
        case 'create_topic':
        case 'add_edge':
        default:
            return 'low';
    }
}
/** Whether the privacy policy forces local-only AI processing (no cloud calls). */
export function isLocalOnlyPolicy(policy) {
    return policy === 'local_only';
}
/** Whether the privacy policy disables AI processing entirely. */
export function isAiDisabledPolicy(policy) {
    return policy === 'disabled';
}
/** Whether cloud LLM providers may be used for this space. */
export function allowsCloudProcessing(policy) {
    return policy === 'inherit_workspace' || policy === 'cloud_allowed';
}
