// Preserve display names; compare their Unicode and case equivalents consistently.
export const groupNameKey = name => name.trim().normalize('NFKC').toLowerCase();
