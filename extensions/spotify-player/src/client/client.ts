import { getApplications, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import SpotifyWebApi from "spotify-web-api-node";
import { CurrentlyPlayingTrack, Response } from "./interfaces";
import { authorize, oauthClient } from "./oauth";
import { runAppleScript } from "run-applescript";
import { isSpotifyInstalled } from "./utils";

const debugMode = false;

export const spotifyApi = new SpotifyWebApi();

async function authorizeIfNeeded(): Promise<void> {
  try {
    await authorize();
  } catch (error) {
    console.error("authorization error:", error);
    showToast({ style: Toast.Style.Failure, title: String(error) });
    return;
  }

  const accessToken = (await oauthClient.getTokens())?.accessToken;
  if (accessToken) {
    spotifyApi.setAccessToken(accessToken);
  } else {
    showToast({ style: Toast.Style.Failure, title: "Invalid accessToken" });
  }
}

export const notPlayingErrorMessage = "Spotify Is Not Playing";

export enum SpotifyPlayingState {
  Playing = "playing",
  Paused = "paused",
  Stopped = "stopped",
}

export async function isSpotifyPlaying(): Promise<SpotifyPlayingState> {
  const script = `
  if application "Spotify" is not running then
	return "stopped"
end if

property playerState : "stopped"

tell application "Spotify"
	try
		set playerState to player state as string
	end try
end tell

return playerState`;

  try {
    const response = await runAppleScript(script);
    const result = response as SpotifyPlayingState;
    return result;
  } catch (err) {
    return SpotifyPlayingState.Stopped;
  }
}

export async function currentPlayingTrack(): Promise<Response<CurrentlyPlayingTrack> | undefined> {
  const installedApplications = await getApplications();
  const spotifyApplication = installedApplications.find((a) => a.bundleId?.includes("spotify"));

  if (!spotifyApplication) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Check if you have Spotify app installed on your Mac",
    });
  }

  const script = `
  if application "${spotifyApplication?.name}" is not running then
	return "${notPlayingErrorMessage}"
end if

property currentTrackId : "Unknown Track"
property currentTrackArtist : "Unknown Artist"
property currentTrackName : "Unknown Name"
property playerState : "stopped"

tell application "Spotify"
	try
		set currentTrackId to id of the current track
		set currentTrackArtist to artist of the current track
		set currentTrackName to name of the current track
		set playerState to player state as string
	end try
end tell


if playerState is "playing" then
  return "{ \\"id\\": \\"" & currentTrackId & "\\", \\"name\\": \\"" & currentTrackName & "\\", \\"artist\\": \\"" & currentTrackArtist & "\\"}"
else if playerState is "paused" then
  return "{ \\"id\\": \\"" & currentTrackId & "\\", \\"name\\": \\"" & currentTrackName & "\\", \\"artist\\": \\"" & currentTrackArtist & "\\"}"
else
	return "${notPlayingErrorMessage}"
end if`;
  try {
    const response = await runAppleScript(script);
    const error = response as string;
    if (error == notPlayingErrorMessage) {
      return { error };
    }
    const track = JSON.parse(response as string) as CurrentlyPlayingTrack;
    return { result: track };
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed getting playing track",
    });
  }
  // Spotify disabled the scope for this...
  // await authorizeIfNeeded();
  // try {
  //   return await spotifyApi
  //     .getMyCurrentPlayingTrack()
  //     .then((response: { body: any }) => response.body as SpotifyApi.CurrentlyPlayingResponse);
  // } catch (e: any) {
  //   return e as unknown as SpotifyApi.ErrorObject;
  // }
}

export async function likeCurrentlyPlayingTrack(): Promise<Response<CurrentlyPlayingTrack> | undefined> {
  const isInstalled = await isSpotifyInstalled();

  if (!isInstalled) {
    await showToast({
      style: Toast.Style.Failure,
      title: "You don't have Spotify Installed",
      message: "Liking songs that're playing on a different device is not supported yet",
    });
    return undefined;
  }

  await authorizeIfNeeded();
  try {
    const track = (await currentPlayingTrack())?.result;
    if (track && track.id) {
      const trackId = track.id.replace("spotify:track:", "");
      try {
        const response = await spotifyApi.addToMySavedTracks([trackId]);
        if (response) {
          return { result: track };
        }
      } catch (e: any) {
        return { error: (e as unknown as SpotifyApi.ErrorObject).message };
      }
    } else {
      return { error: "Playing song hasn't been found" };
    }
  } catch (e: any) {
    return { error: e };
  }
}

export function getArtistAlbums(artistId: string | undefined): Response<SpotifyApi.ArtistsAlbumsResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.ArtistsAlbumsResponse>>({ isLoading: false });

  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!artistId) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));

      try {
        spotifyApi.searchAlbums(artistId);
        const response =
          (await spotifyApi
            .getArtistAlbums(artistId, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.ArtistsAlbumsResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [artistId]);

  return response;
}

export async function startPlaySimilar(trackId: string | undefined): Promise<void> {
  try {
    await authorizeIfNeeded();
    const response =
      (await spotifyApi
        .getRecommendations({ seed_tracks: trackId })
        .then((response: { body: any }) => response.body as SpotifyApi.RecommendationsFromSeedsResponse)) ?? undefined;
    const tracks = response.tracks.flatMap((track) => track.uri);
    if (tracks) {
      await spotifyApi.play({ uris: tracks });
    }
  } catch (e: any) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed Playing Similar",
      message: (e as unknown as SpotifyApi.ErrorObject).message,
    });
  }
}

export function useArtistsSearch(query: string | undefined): Response<SpotifyApi.ArtistSearchResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.ArtistSearchResponse>>({ isLoading: false });
  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!query) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));

      try {
        const response =
          (await spotifyApi
            .searchArtists(query, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.ArtistSearchResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [query]);

  return response;
}

export function getAlbumTracks(albumId: string | undefined): Response<SpotifyApi.AlbumTracksResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.AlbumTracksResponse>>({ isLoading: false });

  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!albumId) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));

      try {
        const response =
          (await spotifyApi
            .getAlbumTracks(albumId, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.AlbumTracksResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [albumId]);

  return response;
}

export function useAlbumSearch(query: string | undefined): Response<SpotifyApi.AlbumSearchResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.AlbumSearchResponse>>({ isLoading: false });

  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!query) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));

      try {
        const response =
          (await spotifyApi
            .searchAlbums(query, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.AlbumSearchResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [query]);

  return response;
}

export function useTrackSearch(query: string | undefined): Response<SpotifyApi.TrackSearchResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.TrackSearchResponse>>({ isLoading: false });

  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!query) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));
      try {
        const response =
          (await spotifyApi
            .searchTracks(query, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.TrackSearchResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [query]);

  return response;
}

export async function searchTracks(query: string, limit: number): Promise<Response<SpotifyApi.TrackSearchResponse>> {
  await authorizeIfNeeded();
  try {
    const response = (await spotifyApi
      .searchTracks(query, { limit })
      .then((response: { body: any }) => response.body as SpotifyApi.TrackSearchResponse)
      .catch((error) => {
        return { error: (error as unknown as SpotifyApi.ErrorObject).message };
      })) as SpotifyApi.TrackSearchResponse | undefined;
    return { result: response };
  } catch (e: any) {
    return { error: (e as unknown as SpotifyApi.ErrorObject).message };
  }
}

export function usePlaylistSearch(query: string | undefined): Response<SpotifyApi.PlaylistSearchResponse> {
  const [response, setResponse] = useState<Response<SpotifyApi.PlaylistSearchResponse>>({ isLoading: false });

  let cancel = false;

  useEffect(() => {
    authorizeIfNeeded();

    async function fetchData() {
      if (cancel) {
        return;
      }
      if (!query) {
        setResponse((oldState) => ({ ...oldState, isLoading: false, result: undefined }));
        return;
      }
      setResponse((oldState) => ({ ...oldState, isLoading: true }));

      try {
        const response =
          (await spotifyApi
            .searchPlaylists(query, { limit: 50 })
            .then((response: { body: any }) => response.body as SpotifyApi.PlaylistSearchResponse)
            .catch((error) => {
              setResponse((oldState) => ({ ...oldState, error: (error as unknown as SpotifyApi.ErrorObject).message }));
            })) ?? undefined;

        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, result: response }));
        }
      } catch (e: any) {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, error: (e as unknown as SpotifyApi.ErrorObject).message }));
        }
      } finally {
        if (!cancel) {
          setResponse((oldState) => ({ ...oldState, isLoading: false }));
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [query]);

  return response;
}

function debugLog(...params: unknown[]): void {
  if (!debugMode) return;
  const logParams: unknown[] = params.map((val) => {
    try {
      return JSON.stringify(val);
    } catch (error) {
      return `Could not stringify debug log: ${error}`;
    }
  });
  console.log(...logParams);
}
