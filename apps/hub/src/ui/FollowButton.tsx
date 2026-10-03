import { useFollowing } from "../data/following";
import { Icon } from "./atoms";

export function FollowButton({ slug, name }: { slug: string; name: string }) {
  const { slugs, toggle } = useFollowing();
  const followed = slugs.includes(slug);
  return <button className={followed ? "btn btn--follow btn--followed" : "btn btn--follow"} type="button" aria-pressed={followed} aria-label={`${followed ? "Unfollow" : "Follow"} ${name}`} onClick={() => toggle(slug)}>
    <Icon name="star" size="sm" />{followed ? "Following" : "Follow"}
  </button>;
}
