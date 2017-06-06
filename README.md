# mediasoup-server
WebRTC SFU mediasoup implementation
All stream are forwarded to ffmpeg as RTMP stream or as media file.

* Mediasoup GitHub [https://github.com/ibc/mediasoup](https://github.com/ibc/mediasoup)
* Mediasoup Web site [https://mediasoup.org](https://mediasoup.org)

# TODO

## Server
* Execute ffmpeg remotely (send message to different server to execute ffmpeg)
* To support scalability and redundancy, hold list of rooms in all servers and redirect socket.io commands to the server that handles the room, SDPs should be generated on the server that holds the room.

## Client
* Rejoin room when socket.io reconnected.
* Accept new room created event.

# Installation

## git clone
```
git clone https://github.com/tan-tan-kanarek/mediasoup-server.git
cd mediasoup-server/
```

## install npm modules

Python 2, make, g++ or clang are required for installing mediasoup.
```
$ npm install
```

# How to use

## run server app
```
$ node server
```
or
```
$ npm start
```

## access with borwser

* Open [http://localhost:3888/](http://localhost:3888/) with Chrome.
* Set room name and click [Join] button
