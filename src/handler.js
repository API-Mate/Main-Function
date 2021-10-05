'use strict'

const jwt = require("jsonwebtoken");
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
        user = await axios.post('http://gateway.openfaas:8080/function/data-function',
          {
            table: "Users",
            record: { _id: userid },
            query: "findOne"
          }).then(function (response) {
            return response;
          });
      } else return context.headers(resheaders).fail('Not Authorized');

      let ret = await HandleRequest(req);

      console.log(req);
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


async function HandleRequest(db, req) {
  return new Promise(resolve => {
    const data = req.data;
    const action = req.action;
    const connectors_id = req.connectors;

    let connectors = connectors_id.filter(function (id) {
      return user.credentials.indexOf(id);
    });

    let rs = {
      all: connectors.length,
      success: 0,
      fail: 0,
      scheduled: 0,
      log = "action Started\n"
    };
    if (data.schedule.toLower() == 'now' || new Date(data.schedule) <= new Date()) {
      connectors.forEach(connector => {
        await axios.post('http://gateway.openfaas:8080/function/' + connector.name + '-function',
          {
            table: "Users",
            record: { _id: userid },
            query: "findOne"
          }).then(function (response) {
            rs.log += '[success]' + response.toString();
            rs.success++;
          }).catch(function (error) {
            rs.log += '[fail]' + error.toString();
            rs.fail++;
          });
      });
    } else {
      await axios.post('http://gateway.openfaas:8080/function/data-function',
        {
          table: "Scheduled-Request",
          record: req,
          query: "insertOne"
        }).then(function (response) {
          rs.log += '[scheduled]' + response.toString();
          rs.scheduled++;
        }).catch(function (error) {
          rs.log += '[fail]' + error.toString();
          rs.fail++;
        });
    }
    resolve(ret);
  });
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