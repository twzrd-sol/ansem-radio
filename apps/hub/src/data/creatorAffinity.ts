import type { Listing } from "./market";

export interface CreatorInterest {
  category: string;
  followedCreators: string[];
}

export interface CreatorRecommendation {
  listing: Listing;
  sharedCategories: string[];
  followedCreators: string[];
}

export interface CreatorAffinity {
  followedWithCategories: number;
  interests: CreatorInterest[];
  recommendations: CreatorRecommendation[];
}

/**
 * Derive creator suggestions only from this browser's selected follows and the current
 * channel board. This does not use or imply data about other fans.
 */
export function creatorAffinity(listings: Listing[], followed: readonly string[], max = 4): CreatorAffinity {
  const selected = new Set(followed);
  const bySlug = new Map(listings.map((listing) => [listing.slug, listing]));
  const followedCreators = [...selected]
    .map((slug) => bySlug.get(slug))
    .filter((listing): listing is Listing => Boolean(listing?.twitch && listing.performance?.game));

  const interestMap = new Map<string, Set<string>>();
  for (const listing of followedCreators) {
    const category = listing.performance!.game!;
    const creators = interestMap.get(category) ?? new Set<string>();
    creators.add(listing.slug);
    interestMap.set(category, creators);
  }
  const interests = [...interestMap.entries()]
    .map(([category, creators]) => ({ category, followedCreators: [...creators] }))
    .sort((a, b) => b.followedCreators.length - a.followedCreators.length || a.category.localeCompare(b.category));

  const recommendations = listings
    .filter((listing) => Boolean(listing.twitch && listing.performance?.game) && !selected.has(listing.slug))
    .map((listing) => {
      const category = listing.performance!.game!;
      const followedInCategory = interestMap.get(category);
      return followedInCategory ? {
        listing,
        sharedCategories: [category],
        followedCreators: [...followedInCategory],
      } : null;
    })
    .filter((recommendation): recommendation is CreatorRecommendation => recommendation !== null)
    .sort((a, b) => b.followedCreators.length - a.followedCreators.length || a.listing.name.localeCompare(b.listing.name))
    .slice(0, Math.max(0, max));

  return { followedWithCategories: followedCreators.length, interests, recommendations };
}
