import { useState } from "react";
import { Search } from "lucide-react";
import { EmptyState } from "../ui/bits";
import { LibraryGate, SearchBox, SearchResults } from "./Home";

export function SearchPage() {
  const [q, setQ] = useState("");
  return (
    <div className="mx-auto max-w-6xl pb-6">
      <div className="sticky top-0 z-10 bg-bg/95 px-4 pb-3 pt-4 backdrop-blur">
        <h1 className="mb-3 text-2xl font-bold">Search</h1>
        <SearchBox value={q} onChange={setQ} autoFocus />
      </div>
      <LibraryGate>
        {(index) =>
          q.trim() ? (
            <div className="px-2">
              <SearchResults index={index} q={q} />
            </div>
          ) : (
            <EmptyState icon={<Search size={40} />} title="Search your library">
              Find songs, albums and artists by title, artist or album name.
            </EmptyState>
          )
        }
      </LibraryGate>
    </div>
  );
}
