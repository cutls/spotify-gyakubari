import * as functions from '@google-cloud/functions-framework'
import { SpotifyApi } from '@spotify/web-api-ts-sdk'
import dayjs from 'dayjs'
import jimp from 'jimp'
import dotenv from 'dotenv'
dotenv.config()
const config = process.env
process.env.TZ = 'Asia/Tokyo'
const clientId = config.SPOTIFY_CLIENT_ID || ''
const clientSecret = config.SPOTIFY_CLIENT_SECRET || ''
const playlistId = config.SPOTIFY_SOURCE_PLAYLIST || ''
const newPlaylistId = config.SPOTIFY_NEW_PLAYLIST || ''
const complimentPlaylistId = config.SPOTIFY_COMPLEMENT_PLAYLIST || ''
const refreshToken = config.SPOTIFY_REFRESH_TOKEN || ''


async function main() {
    const current = dayjs().format('YYYY/MM/DD HH:mm') // 説明文の末尾に追加するための日時
    const cred = await getAccessToken()
    const sdk = SpotifyApi.withAccessToken(clientId, cred) // SDK init
    
    const playlist = await sdk.playlists.getPlaylistItems(playlistId) // 日本のTOP 50を取得
    const complimentPlaylist = await sdk.playlists.getPlaylistItems(complimentPlaylistId) // 曲が足りない時に使うやつを取得
    const { items } = playlist // TOP 50の曲たち
    const { items: cItems } = complimentPlaylist // 補完用の曲たち
    const artistIds = items.map((i) => i.track.artists[0].id) // TOP 50の曲たちのアーティストIDを全部持ってくる
    const mostFrequentArtist = mostFrequent(artistIds) // TOP 50の曲たちのアーティストIDの中で最も多いものを取得
    const topSongIndex = items.findIndex((s) => s.track.artists[0].id === mostFrequentArtist) // 最も多いアーティストの曲の中で唯一残す、最人気曲のインデックスを取得
    
    const uniqueCItems = cItems.filter((i) => !artistIds.includes(i.track.artists[0].id) && i.track.artists[0].id !== mostFrequentArtist) // 補完用のプレイリストからアーティストが被らないものを取得
    const newItems = items.filter(({ track }, i) => {
        const { artists } = track
        if (i !== topSongIndex && artists[0].id === mostFrequentArtist) return false // 最も多いアーティストの曲の中で唯一残す、最人気曲以外を除外
        return true
    }) // 新しいプレイリストに入る曲たち
    let uris = newItems.map((i) => i.track.uri) // 新しいプレイリストに入る曲たちのURI
    const addTr = 50 - uris.length // 足りない曲の数
    if (addTr >= 0) {
        const uniqueCItemsFor50 = uniqueCItems.slice(0, addTr) // 足りない曲の数だけ補完用のプレイリストから取得
        const uniqueCItemsFor50Uris = uniqueCItemsFor50.map((c) => c.track.uri) // URIだけ取り出す
        uris = uris.concat(uniqueCItemsFor50Uris) // 追加
    }
    await sdk.playlists.updatePlaylistItems(newPlaylistId, { uris }) // 自分のプレイリストに上書き
    const artist = await sdk.artists.get(mostFrequentArtist || '') // 最も多いアーティストの情報を取得(アーティスト名、カバー画像用)
    await sdk.playlists.changePlaylistDetails(newPlaylistId, {
        name: `トップ50 - 日本 (${artist.name}少なめ)`,
        description: `逆張りトップ50 bot GitHub: cutls/spotify-gyakubari (更新日時: ${current})`
    }) // プレイリストの名前と説明文を更新
    const images = artist.images
    sdk.playlists.addCustomPlaylistCoverImageFromBase64String(newPlaylistId, await makeArtwork(images[images.length - 1].url)) // カバー画像を更新
    console.log('playlist updated')
}
functions.cloudEvent('makePlaylist', async () => {
    main()
}) // Google Cloud Function用のエントリーポイント
main()
interface IMF {
    [id: string]: number
}
// 配列を渡して一番多いものを返す
function mostFrequent(array: string[]) {
    if (array.length === 0) return null

    const max: IMF = {}
    for (const a of array) max[a] = (max[a] || 0) + 1

    const maxCount = Math.max(...Object.values(max))
    const mostFrequentValue = Object.keys(max).find(key => max[key] === maxCount)
    return mostFrequentValue
}
// リフレッシュトークンからアクセストークンを生成
async function getAccessToken () {
    const url = 'https://accounts.spotify.com/api/token'
    const payload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(clientId + ':' + clientSecret).toString('base64')}`
      },
      body: `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${clientId}`
    }
    const body = await fetch(url, payload)
    const response = await body.json()
    console.log(response)
    return response
}
// アートワークを作成
async function makeArtwork(cover: string) {
    const art = (await jimp.read(cover))
    const comp = (await jimp.read(config.COVER || '')).composite(art, 20, 100)
    return (await comp.getBase64Async(jimp.MIME_JPEG)).split(';base64,')[1]
}
