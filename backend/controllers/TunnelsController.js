const Controller = require('./Controller');

class TunnelsController {
  constructor (Service) {
    this.service = Service;
  }

  async tunnelsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsGET);
  }

  async tunnelsNotificationsPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsNotificationsPUT);
  }

  async tunnelsDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsDELETE);
  }
}

module.exports = TunnelsController;
