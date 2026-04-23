import { Component } from '@angular/core';
import { PhoneOtpFormComponent } from './phone-otp-form.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [PhoneOtpFormComponent],
  template: `<app-phone-otp-form mode="login" />`,
})
export class LoginComponent {}
