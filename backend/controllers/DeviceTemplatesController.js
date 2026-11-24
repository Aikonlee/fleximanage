const Controller = require('./Controller');

class DeviceTemplatesController {
  constructor (Service) {
    this.service = Service;
  }

  async devicetemplatesGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesGET);
  }

  async devicetemplatesPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesPOST);
  }

  async devicetemplatesIdGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdGET);
  }

  async devicetemplatesIdPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdPUT);
  }

  async devicetemplatesIdDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdDELETE);
  }
}

module.exports = DeviceTemplatesController;
