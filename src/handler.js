'use strict'

const jwt = require("jsonwebtoken");
const axios = require("axios");
var ObjectID = require('mongodb').ObjectID;

const resheaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000"
};
let user = null;
let userid;

module.exports = async (event, context) => {
  if (event.method === 'OPTIONS') {
    var headers = {};
    headers["Access-Control-Allow-Origin"] = "http://localhost:3000";
    headers["Access-Control-Allow-Methods"] = "POST, GET, PUT, OPTIONS";
    headers["Access-Control-Allow-Credentials"] = false;
    headers["Access-Control-Max-Age"] = '86400'; // 24 hours
    headers["Access-Control-Allow-Headers"] = "*";

    return context
      .status(200)
      .headers(headers)
      .succeed();
  } else {
    try {
      console.log(event);
      let req = event.body;

      if (req == null)
        return context
          .status(404)
          .headers(resheaders)
          .succeed("No Request!");
      if (event.headers["authorization"] && event.headers["authorization"].startsWith("Bearer ") && event.headers["authorization"].length > 7) {
        console.log("vfret");
        const vfret = verifyToken(event.headers["authorization"].split(' ')[1]);
        console.log(vfret);
        if (!vfret.user_id) return context.headers(resheaders).fail(vfret.toString());
        userid = vfret.user_id;
      } else {
        userid = req.userid;
      }

      if (userid == null || userid == undefined || userid == '') return context.headers(resheaders).fail('Not Authorized');

      await axios.post('http://gateway.openfaas:8080/function/data-function',
        {
          table: "Users",
          record: { _id: userid },
          query: "findOne"
        }).then(function (response) {
          user = response.data;
        });

      console.log('user');
      console.log(user);
      let ret = await HandleRequest(req);

      console.log(req);
      console.log(ret);
      if (ret == "Query not found")
        return context
          .status(400)
          .headers(resheaders)
          .succeed(ret);
      else {
        //if (req.table == "Users") ret.password = null;
        return context
          .status(200)
          .headers({
            "Content-type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "http://localhost:3000"
          })
          .succeed(ret)
      }
    }
    catch (err) {
      return context
        .status(500)
        .headers(resheaders)
        .succeed(err.toString());
    }
  }
}


async function HandleRequest(req) {
  const data = req.data;
  const action = req.action;
  const connectors_ids = req.connectors;

  // let connectors = connectors_ids.filter(function (id) {
  //   return user.accounts.indexOf(id);
  // });
  // console.log(connectors);
  if (req.scheduleid != null && req.scheduleid != undefined) userid = req.scheduleid;
  let rs = {
    _id: new ObjectID(),
    user_id: userid,
    all: connectors_ids.length,
    success: 0,
    fail: 0,
    scheduled: 0,
    log: "action Started\n",
    requests: req,
    responses: [],
    datetime: new Date(),
    active: true,
  };
  console.log(rs);

  if (action == "send") {
    if (data.schedule.toLowerCase() == 'now' || new Date(data.schedule) <= new Date()) {
      console.log('sendtoconnectorsnow');
      for (const connector_id of connectors_ids) {
        const connector = user.accounts[connector_id];
        console.log(connector);
        const connectorReq = {
          title: data.title,
          message: data.content,
          credential: connector.credential,
        };
        console.log(connectorReq);
        console.log('connectorReq');
        await axios.post('http://gateway.openfaas:8080/function/' + connector.name.toLowerCase() + '-connector',
          connectorReq).then(function (response) {
            console.log(response)
            rs.log += JSON.stringify('[success]' + response.data.message + '\n');
            rs.responses.push({
              connector_id: connector_id, connector_name: connector.name.toLowerCase(), connector, request: connectorReq, response: response.data,
              status: 'success',
              datetime: new Date()
            });
            rs.success++;
          }).catch(function (error) {
            console.log(error)
            rs.log += JSON.stringify('[fail]' + error.message + '\n');
            rs.responses.push({
              connector_id: connector_id, connector_name: connector.name.toLowerCase(), connector, request: {
                message: data.content,
                credential: connector.credential,
              }, response: error.message,
              status: 'fail',
              datetime: new Date()
            });
            rs.fail++;
          });
      }

      console.log('dblognow');
      if (req.scheduleid != null && req.scheduleid != undefined) { //update schedule
        const dbreq = {
          table: "Requests",
          record: { _id: req.scheduleid },
          query: "updateOne",
          changes: { $inc: { success: rs.success, fail: rs.fail }, $push: { responses: { $each: rs.responses } }, $set: { log: rs.log } }//$set: { log: { $concat: ["$log", rs.log] } } }
        };
        console.log('dbreq');
        console.log(JSON.stringify(dbreq));
        await axios.post('http://gateway.openfaas:8080/function/data-function', dbreq
        ).then(function (response) {
          rs.log += '[successDb]' + JSON.stringify(response) + '\n';
        }).catch(function (error) {
          rs.log += '[failOnDb]' + JSON.stringify(error);
          console.log('dbreqerror');
          console.log(error);
        });
      } else {
        await axios.post('http://gateway.openfaas:8080/function/data-function',
          {
            table: "Requests",
            record: rs,
            query: "insertOne"
          }).then(function (response) {
            rs.log += '[successDb]' + JSON.stringify(response) + '\n';
          }).catch(function (error) {
            rs.log += '[failOnDb]' + JSON.stringify(error);
          });
      }

    } else {
      rs.scheduled = rs.all;
      rs.log = "schedule submitted\n";
      await axios.post('http://gateway.openfaas:8080/function/data-function',
        {
          table: "Requests",
          record: rs,
          query: "insertOne"
        }).then(function (response) {
          rs.log += '[scheduledDb]' + JSON.stringify(response.data) + '\n';
        }).catch(function (error) {
          rs.log += '[failOnDb]' + JSON.stringify(error);
        });
    }
  }
  console.log(rs);
  return rs;
}

const verifyToken = (token) => {
  // const token =
  //   req.body.token || req.query.token || req.headers["x-access-token"];
  if (!token) {
    return "A token is required for authentication";
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_TOKEN_KEY);
    return decoded;
  } catch (err) {
    return "Invalid Token " + err.toString();
  }
};