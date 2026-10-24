// A small Markdown renderer for the Director's replies: paragraphs, headings, lists, bold,
// italics, inline code and links. Builds React elements, never HTML strings.

import { Fragment, type ReactNode } from "react";

function safeHref(href: string) {
  return /^(https:\/\/|\/(?!\/))/.test(href) ? href : null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|https:\/\/[^\s)<>]+|\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyBase}-${i++}`;
    if (match[2]) out.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3]) out.push(<code key={key}>{match[3]}</code>);
    else if (match[4]) {
      const href = safeHref(match[5]);
      out.push(href ? <a key={key} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">{match[4]}</a> : match[4]);
    } else if (match[6]) out.push(<em key={key}>{match[6]}</em>);
    else out.push(<a key={key} href={match[0]} target="_blank" rel="noreferrer">{match[0].length > 60 ? `${match[0].slice(0, 57)}…` : match[0]}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      blocks.push(<Tag key={i}>{inline(heading[2], `h${i}`)}</Tag>);
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i].replace(marker, "");
        i++;
        // Indented continuation lines belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={i}>{items.map((item, n) => <li key={n}>{inline(item, `l${i}-${n}`)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={i}>
        {para.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p, `p${i}-${n}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
