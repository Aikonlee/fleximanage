const Controller = require('./Controller');

class LinkMonitorsController {
  constructor (Service) {
    this.service = Service;
  }

  async linkmonitorsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.linkmonitorsGET);
  }

  async linkmonitorsPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.linkmonitorsPOST);
  }

  async linkmonitorsIdGET (request, response) {
    await Controller.handleRequest(request, response, this.service.linkmonitorsIdGET);
  }

  async linkmonitorsIdPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.linkmonitorsIdPUT);
  }

  async linkmonitorsIdDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.linkmonitorsIdDELETE);
  }
}

module.exports = LinkMonitorsController;
