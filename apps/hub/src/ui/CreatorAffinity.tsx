import { creatorAffinity } from "../data/creatorAffinity";
import type { Listing } from "../data/market";
import { SampleTag } from "./atoms";

/** Suggestions from the viewer's own selected follows and categories on the current board. */
export function CreatorAffinity({ listings, followed, sample = false }: {
  listings: Listing[];
  followed: readonly string[];
  sample?: boolean;
}) {
  const affinity = creatorAffinity(sample ? listings : listings.filter((listing) => !listing.demo), followed);
  return (
    <section className="collect creator-affinity" aria-labelledby="creator-affinity-title">
      <div className="collect__head">
        <h2 className="label" id="creator-affinity-title">Creators near your interests</h2>
        {sample && <SampleTag />}
      </div>
      <p className="small">Based on categories among channels you follow. Suggestions use the current channel board; no other fans' data is used.</p>
      {affinity.interests.length === 0 ? (
        <p className="small">Follow a channel with a category on the board to see related creators here.</p>
      ) : affinity.recommendations.length === 0 ? (
        <p className="small">No other listed channels share a category with your follows in this read.</p>
      ) : (
        <ul className="collect__badges" aria-label="Creators in categories you follow">
          {affinity.recommendations.map(({ listing, sharedCategories, followedCreators }) => (
            <li className="badge" key={listing.slug}>
              <a href={`#/s/${listing.slug}`}><strong>{listing.name}</strong></a>
              <span className="small">{sharedCategories[0]} · shared with {followedCreators.length} of your followed channels</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small fine">Categories are from the channel board · Data: Twitch. Follows are saved in this browser.</p>
    </section>
  );
}
