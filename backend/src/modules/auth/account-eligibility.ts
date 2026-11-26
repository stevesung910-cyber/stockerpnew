type AccountState = {
  active: boolean;
  legacyRegistration: boolean;
  emailVerifiedAt: Date | null;
  ownerApprovedAt: Date | null;
};

export function accountEligibility(user: AccountState) {
  if (!user.active) return null;
  if (user.ownerApprovedAt) return "OWNER_APPROVED";
  if (user.legacyRegistration && user.emailVerifiedAt) return "LEGACY_VERIFIED";
  return null;
}
