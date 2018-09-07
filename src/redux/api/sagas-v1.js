import { all, call, select, takeEvery, take, put, race, fork } from 'redux-saga/effects';
import actions from './actions-v1';
import uuidv1 from 'uuid/v1';
import config from '../../config';
import httpApi from '../../httpApi';
import { store } from '../../redux/store';
import io from 'socket.io-client';

const apiHttp = httpApi('http://localhost',8080);

// util function -> take only once
function* takeFirst(pattern, saga, ...args) {
    const task = yield fork(function* () {
        while(true) {
            const action = yield take(pattern);
            yield call(saga, ...args.concat(action));
        }
    });
    return task;
}

// wait :: Number -> Promise
const wait = ms => (
    new Promise(resolve => {
        setTimeout(() => resolve(), ms)
    })
);

const webSocket = io('http://localhost:8080',{'forceNew': true});
window.ws = webSocket
webSocket.on('socket-reply',(args) => {
    if (args) {
        store.dispatch(args)
    }
})
let ipcRenderer = {
    send: (version, request) => new Promise((res, rej) => {
        if(version === 'api') {
            return apiHttp.request(request.payload.path, request.payload.data, request.payload.method || 'POST')
                .then((data) =>{
                    console.log('request',data)
                    store.dispatch({type:request.type+'_SUCCESS', payload: data })
                    res(data)
                })
                .catch((e)=> {
                    console.log('errror', e)
                    store.dispatch({type:request.type+'_FAILD', payload: e });
                    rej(e)
                })
        }
        else if(version === 'socket') {
            webSocket.emit('data',{type: request.type, payload: request.payload})
        }
    })
}

try {
    ipcRenderer = window.require('electron').ipcRenderer;
} catch (e) {
    console.log('IN BROWSER')
}

export const user = function*() {
    
    yield takeEvery('LOGOUT', function*(){
        yield ipcRenderer.send('-socket', {
            type: 'LOGOUT',
            payload: {
                path: '/control/logout/'
            }
        })
    })

    yield takeEvery('CONNECT', function*(){
        yield ipcRenderer.send('api', {
            type: 'CHECK_LOGGIN',
            payload: {
                path: '/rsLoginHelper/isLoggedIn'
            }
        })
    })

    yield takeEvery(['CHECK_LOGGIN_SUCCESS','QUERY_LOCATIONS'], function*(action){
        const result = yield ipcRenderer.send('api', {
            type: 'QUERY_LOCATIONS',
            payload: {
                path: '/rsLoginHelper/getLocations',
                method: 'GET'
            }
        })
    })

    yield takeEvery('QUERY_LOCATIONS_SUCCESS', function*(action) {
        const isLogged = yield select(state => state.Api.runstate === true);

        //Si no hay cuentas crear una
        if(action.payload.locations.length === 0)
            yield put({type: actions.CREATE_ACCOUNT})
        //Si el sistema tiene cuentas y fugura sin login hago lopgin
        else if (isLogged === false)
            yield put({type: actions.LOGIN, payload: action.payload.locations[0]})
        //Sino simulo un login exitoso
        else
            yield put({type: actions.LOGIN_SUCCESS, payload: action.payload.locations[0]})
    })

    yield takeEvery(actions.CREATE_ACCOUNT, function*(action){
        const username = uuidv1() + '_repo';
        yield ipcRenderer.send('api', {
            type: actions.LOGIN,
            payload: {
                path: '/rsLoginHelper/createLocation',
                data: {
                    location: {
                        mPpgName: username,
                        mLocationName: username
                    },
                    password: '0000'
                },
            }
        })
    })

    yield takeEvery(actions.LOGIN, function*(action) {
        yield ipcRenderer.send('api', {
            type: actions.LOGIN,
            payload: {
                path: '/rsLoginHelper/attemptLogin',
                data: {
                    account: action.payload.mLocationId,
                    password: '0000'
                }
            }
        })
    });

    yield takeEvery(['LOGIN_SUCCESS','GET_SELF_CERT'], function*(){
        const userId = yield select(state => state.Api.user.mLocationId)
        yield ipcRenderer.send('api', {
            type: 'GET_SELF_CERT',
            payload: {
                path: '/rsPeers/GetRetroshareInvite',
                data: {
                    sslId: userId
                }
            }
        })
    })

    yield takeEvery(actions.LOGIN_SUCCESS, function*() {
        yield put({type: 'START_SYSTEM'})
    });

}


export const channels = function*() {
    yield takeEvery('START_SYSTEM' , function*(){
        yield put({ type: 'LOADCHANNELS' })
        while(true) {
            const winner = yield race({
                stopped: take('CHANNELS_MONITOR_STOP'),
                tick: call(wait, 60000)
            })

            if (!winner.stopped) {
                yield put({ type: 'LOADCHANNELS' })
            } else {
                break
            }
        }
    })

    yield takeEvery('LOADCHANNELS', function*() {
        yield ipcRenderer.send('api', {
            type: 'LOADCHANNELS',
            payload: {
                path: '/rsGxsChannels/getChannelsInfo'
            }
        })
    })
}

export const peers = function*() {
    yield takeEvery(['START_SYSTEM'], function*(action){
        yield put({type: 'LOADPEERS'})
        while(true) {
            const winner = yield race({
                stopped: take('PEER_MONITOR_STOP'),
                tick: call(wait, 10000)
            })

            if (!winner.stopped) {
                yield put({type: 'LOADPEERS'})
            } else {
                break
            }
        }
    });

    yield takeEvery('LOADPEERS', function*() {
        yield ipcRenderer.send('api', {
            type: 'PEERS',
            payload: {
                path: '/rsPeers/getFriendList'
            }
        })
    })

    let joinTier = 0;
    yield takeEvery('PEERS_SUCCESS', function*(action){
        if(joinTier !== 0) return;
        joinTier = 1;
        if (typeof action.payload.sslIds !== 'undefined' && action.payload.sslIds.length === 0){
            const api = yield select(state => state.Api)
            yield put({
                type: actions.JOIN_TIER,
                payload: {
                    url: config.tiers1[0].url,
                    remote: true,
                    cert: api.cert,
                    user: api.user.mLocationName
                }
            })
        }
    })
}

export const search = function*(){
    yield takeEvery('START_SYSTEM' , function*(){
        return;
        yield wait(342);
        yield put({type: 'SEARCH_GET_RESULTS'})
        while(true) {
            const winner = yield race({
                stopped: take('SEARCH_ALL_STOP'),
                tick: call(wait, 1299)
            })

            if (!winner.stopped) {
                yield put({type: 'SEARCH_GET_ACTIVES'})
                yield call(wait, 199)
                yield put({type: 'SEARCH_GET_RESULTS'})
            } else {
                break
            }
        }
    })

    //START SEARCH
    yield takeEvery('SEARCH_NEW', function*(action) {
        yield ipcRenderer.send('-socket', {
            type: 'SEARCH_NEW',
            payload: {
                path: '/filesearch/create_search',
                data: {
                    distant: true,
                    search_string: action.payload
                }
            }
        })
    })

    yield takeEvery('SEARCH_GET_RESULTS', function*(action) {
        if (!action.payload){
            action.payload = yield select(state => state.Api.searchId);
        }
        if(action.payload && action.payload !== '') {
            yield ipcRenderer.send('-socket', {
                type: 'SEARCH_GET_RESULTS',
                payload: {
                    path: '/filesearch/get_search_result',
                    data: {
                        search_id: action.payload
                    }
                }
            })
        }
    })

    yield takeEvery('SEARCH_GET_ACTIVES', function*() {
        yield ipcRenderer.send('-socket', {
            type: 'SEARCH_GET_ACTIVES',
            payload: {
                path: '/filesearch'
            }
        })
    })

    yield takeEvery('SEARCH_NEW_SUCCESS', function*(){
        yield ipcRenderer.send('-socket', {
            type: 'SEARCH_GET_ACTIVES',
            payload: {
                path: '/filesearch'
            }
        })
    })

}